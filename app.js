// --- DOM refs
const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const resultsEl = document.getElementById("results");
const listEl = document.getElementById("reading-list"); // may be null (no sidebar)
const clearBtn = document.getElementById("clear-list"); // may be null

// NEW: toolbar + modal refs
const parentToggle = document.getElementById("parent-toggle");
const bagBtn = document.getElementById("bag-btn");
const bagCountEl = document.getElementById("bag-count");
const bagModal = document.getElementById("bag-modal");
const bagItemsEl = document.getElementById("bag-items");
const closeBagBtn = document.getElementById("close-bag");

// --- helpers
const toHttps = (url) => (url ? url.replace(/^http:\/\//, "https://") : "");
const uniqueById = (arr) => {
  const seen = new Set();
  return arr.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
};
let lastResults = []; // cache to refresh buttons after list edits

// --- localStorage utils
const KEY = "readingList";
const getList = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const saveList = (arr) => localStorage.setItem(KEY, JSON.stringify(arr));

// NEW: Parent Control storage
const PARENT_KEY = "parentControl"; // "on" | "off"
const getParent = () => localStorage.getItem(PARENT_KEY) === "on";
const setParent = (on) => localStorage.setItem(PARENT_KEY, on ? "on" : "off");

// NEW: Last query storage (third LocalStorage property)
const LAST_QUERY_KEY = "lastQuery";
function saveLastQuery(q){ localStorage.setItem(LAST_QUERY_KEY, q); }
function getLastQuery(){ return localStorage.getItem(LAST_QUERY_KEY) || ""; }

// --- render helpers
function bookCard(b, actionBtn) {
  const div = document.createElement("article");
  div.className = "card";

  const img = document.createElement("img");
  img.alt = b.title || "Cover";
  img.loading = "lazy";
  img.decoding = "async";

  const fallback = b.isbn ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg` : "";
  img.src = toHttps(b.thumbnail || fallback);
  img.onerror = () => { img.style.display = "none"; };

  const content = document.createElement("div");
  content.className = "content";

  const h3 = document.createElement("h3");
  h3.textContent = b.title || "Untitled";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [b.authors?.join(", "), b.year ? `• ${b.year}` : ""]
    .filter(Boolean).join(" ");

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = b.publisher ? b.publisher : "";

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.appendChild(actionBtn);

  content.append(h3, meta, badge, actions);
  div.append(img, content);
  return div;
}

function renderResults(items) {
  lastResults = items;

  // Parent Control filter
  const visible = getParent()
    ? items.filter(b => (b.maturity || "NOT_MATURE") !== "MATURE")
    : items;

  resultsEl.innerHTML = "";
  if (!visible.length) {
    resultsEl.innerHTML = "<p>No results. Try another search.</p>";
    return;
  }
  const current = getList();
  const idsInList = new Set(current.map(x => x.id));

  visible.forEach(b => {
    const btn = document.createElement("button");
    const inList = idsInList.has(b.id);
    btn.textContent = inList ? "In List" : "Add";
    btn.disabled = inList;
    btn.addEventListener("click", () => {
      const updated = uniqueById([...getList(), b]);
      saveList(updated);
      updateBagCount();          // ✅ only update badge
      renderResults(items);      // refresh button state
    });
    resultsEl.appendChild(bookCard(b, btn));
  });
}

function updateBagCount() {
  if (bagCountEl) bagCountEl.textContent = String(getList().length);
}

function renderList() {
  const items = getList();

  // If no sidebar exists, just keep badge up-to-date
  if (!listEl) {
    updateBagCount();
    return;
  }

  // Sidebar (only if present)
  listEl.innerHTML = "";
  if (!items.length) {
    listEl.innerHTML = "<p class='meta'>Your reading list is empty.</p>";
    updateBagCount();
    return;
  }
  items.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      saveList(getList().filter(x => x.id !== b.id));
      renderList();
      if (lastResults.length) renderResults(lastResults);
    });
    listEl.appendChild(bookCard(b, btn));
  });
  updateBagCount();
}

// --- API: Google Books (primary)
async function searchGoogleBooks(q) {
  const digits = q.replace(/[^0-9Xx]/g, "");
  const isIsbn = digits.length === 10 || digits.length === 13;
  const query = isIsbn ? `isbn:${digits}` : encodeURIComponent(q);

  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Google Books request failed");
  const data = await res.json();

  return (data.items || []).map(item => {
    const v = item.volumeInfo || {};
    const industry = v.industryIdentifiers || [];
    const isbn13 = industry.find(i => i.type === "ISBN_13")?.identifier;
    return {
      id: item.id,
      title: v.title || "Untitled",
      authors: v.authors || [],
      year: v.publishedDate ? v.publishedDate.slice(0, 4) : "",
      publisher: v.publisher || "",
      thumbnail: toHttps(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || ""),
      isbn: isbn13 || industry.find(i => i.type === "ISBN_10")?.identifier || "",
      maturity: v.maturityRating || "NOT_MATURE" // used by Parent Control
    };
  });
}

// --- API: Open Library enrichment (secondary)
async function enrichWithOpenLibrary(book) {
  const isbn = book.isbn;
  if (!isbn) return book;
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!res.ok) return book;
    const data = await res.json();
    return {
      ...book,
      subjects: data.subjects || [],
      pagesOL: data.number_of_pages || null
    };
  } catch {
    return book;
  }
}

// --- events
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = queryInput.value.trim();
  if (!q) return;

  // save last query
  saveLastQuery(q);

  resultsEl.innerHTML = "<p class='meta'>Searching…</p>";
  try {
    const items = await searchGoogleBooks(q);
    const enriched = await Promise.all(items.map(enrichWithOpenLibrary));
    renderResults(enriched);
  } catch (err) {
    resultsEl.innerHTML = `<p class='meta'>Error: ${err.message}</p>`;
  }
});

if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    saveList([]);
    renderList();
    if (lastResults.length) renderResults(lastResults);
  });
}

// Parent Control toggle
if (parentToggle) {
  parentToggle.checked = getParent();
  parentToggle.addEventListener("change", () => {
    setParent(parentToggle.checked);
    if (lastResults.length) renderResults(lastResults);
  });
}

// Book bag modal
bagBtn?.addEventListener("click", () => {
  bagItemsEl.innerHTML = "";
  const items = getList();
  if (!items.length) {
    bagItemsEl.innerHTML = "<p class='meta'>Your book bag is empty.</p>";
  } else {
    items.forEach(b => {
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = "Remove";
      btn.addEventListener("click", () => {
        saveList(getList().filter(x => x.id !== b.id));
        renderList();    // updates badge
        bagBtn.click();  // rebuild modal content
      });
      bagItemsEl.appendChild(bookCard(b, btn));
    });
  }
  bagModal.hidden = false;
  bagBtn?.setAttribute("aria-expanded","true"); // a11y
});
closeBagBtn?.addEventListener("click", () => {
  bagModal.hidden = true;
  bagBtn?.setAttribute("aria-expanded","false"); // a11y
});
bagModal?.addEventListener("click", (e) => {
  if (e.target === bagModal) {
    bagModal.hidden = true; // click backdrop
    bagBtn?.setAttribute("aria-expanded","false");
  }
});

// initial paint
renderList();

// --- Restore last search on page load ---
const last = getLastQuery();
if (last) {
  queryInput.value = last;
  form.dispatchEvent(new Event("submit"));
}
