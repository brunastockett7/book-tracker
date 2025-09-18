// --- DOM refs
const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const resultsEl = document.getElementById("results");
const listEl = document.getElementById("reading-list");
const clearBtn = document.getElementById("clear-list");

// --- localStorage utils
const KEY = "readingList";
const getList = () => JSON.parse(localStorage.getItem(KEY) || "[]");
const saveList = (arr) => localStorage.setItem(KEY, JSON.stringify(arr));

// --- render helpers
function bookCard(b, actionBtn) {
  const div = document.createElement("article");
  div.className = "card";

  const img = document.createElement("img");
  img.alt = b.title || "Cover";

  // Prefer Google Books thumbnail; fallback to Open Library by ISBN
  img.src = b.thumbnail || (b.isbn ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-M.jpg` : "");
  img.onerror = () => { img.style.display = "none"; }; // hide if broken

  const content = document.createElement("div");
  content.className = "content";

  const h3 = document.createElement("h3");
  h3.textContent = b.title || "Untitled";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [b.authors?.join(", "), b.year ? `• ${b.year}` : ""].filter(Boolean).join(" ");

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
  resultsEl.innerHTML = "";
  if (!items.length) {
    resultsEl.innerHTML = "<p>No results. Try another search.</p>";
    return;
  }
  const current = getList();
  const idsInList = new Set(current.map(x => x.id));

  items.forEach(b => {
    const btn = document.createElement("button");
    btn.textContent = idsInList.has(b.id) ? "In List" : "Add";
    btn.disabled = idsInList.has(b.id);
    btn.addEventListener("click", () => {
      const updated = [...getList(), b];
      saveList(updated);
      renderList();
      renderResults(items); // refresh buttons
    });
    resultsEl.appendChild(bookCard(b, btn));
  });
}

function renderList() {
  listEl.innerHTML = "";
  const items = getList();
  if (!items.length) {
    listEl.innerHTML = "<p class='meta'>Your reading list is empty.</p>";
    return;
  }
  items.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      saveList(getList().filter(x => x.id !== b.id));
      renderList();
    });
    listEl.appendChild(bookCard(b, btn));
  });
}

// --- API: Google Books (primary)
async function searchGoogleBooks(q) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20`;
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
      thumbnail: v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "",
      isbn: isbn13 || industry.find(i => i.type === "ISBN_10")?.identifier || ""
    };
  });
}

// --- Fallback cover via Open Library if missing (optional)
/* Example of using Open Library metadata if you want to enhance later:
async function fetchOpenLibraryByISBN(isbn) {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!res.ok) return null;
  return await res.json();
}
*/

// --- events
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = queryInput.value.trim();
  if (!q) return;
  resultsEl.innerHTML = "<p class='meta'>Searching…</p>";
  try {
    const items = await searchGoogleBooks(q);
    renderResults(items);
  } catch (err) {
    resultsEl.innerHTML = `<p class='meta'>Error: ${err.message}</p>`;
  }
});

clearBtn.addEventListener("click", () => {
  saveList([]);
  renderList();
});

// initial paint
renderList();
