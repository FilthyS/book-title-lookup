/**
 * Shared raw Open Library HTTP response fixtures (research #1 fixture
 * guidance 1-9; issue #8 contract harness). Every fixture is a fixed snapshot
 * modeled on read-only probes retrieved 2026-09-05; live catalog values are
 * never test assertions. Fixture bodies are the exact raw JSON/HTML upstream
 * payloads decoders consume, recorded with requested path/query, status,
 * content type, Location, and decoder schema version.
 */

export interface OlHttpFixture {
  readonly id: string;
  /** Request path on openlibrary.org, e.g. `/works/OL274505W.json`. */
  readonly path: string;
  /** Query parameters by name; matching ignores order. */
  readonly query?: Readonly<Record<string, string>>;
  readonly status: number;
  readonly contentType: string;
  /** Location header for 3xx fixtures. */
  readonly location?: string;
  readonly body: string;
}

export const OL_FIXED_AT = "2026-09-05T12:34:56.789Z";
export const OL_DECODER_SCHEMA_VERSION = 1;

const SEARCH_FIELDS =
  "key,title,subtitle,author_name,author_key,first_publish_year,edition_count,edition_key,language,alternative_title,alternative_subtitle";

const searchBaiNian: OlHttpFixture = {
  id: "search-bai-nian",
  path: "/search.json",
  query: {
    title: "百年孤独",
    fields: SEARCH_FIELDS,
    limit: "20",
  },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    numFound: 2,
    start: 0,
    numFoundExact: true,
    num_found: 2,
    docs: [
      {
        key: "/works/OL31608032W",
        title: "百年孤独(精)",
        author_name: ["新华书店北美网 加西亚·马尔克斯 著，新经典 出品"],
        author_key: ["OL11506562A"],
        edition_count: 1,
        first_publish_year: 2017,
      },
      {
        key: "/works/OL43416865W",
        title: "百年孤独",
        author_name: ["Gabriel García Márquez", "黄锦炎", "沈国正", "陈泉"],
        author_key: [
          "OL15389184A",
          "OL15500273A",
          "OL15500274A",
          "OL15500275A",
        ],
        edition_count: 1,
        first_publish_year: 1984,
        language: ["chi"],
      },
    ],
  }),
};

const searchCien: OlHttpFixture = {
  id: "search-cien",
  path: "/search.json",
  query: {
    title: "Cien años de soledad",
    fields: SEARCH_FIELDS,
    limit: "20",
  },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    numFound: 99,
    start: 0,
    numFoundExact: true,
    docs: [
      {
        key: "/works/OL274505W",
        title: "Cien años de soledad",
        author_name: ["Gabriel García Márquez"],
        author_key: ["OL27363A"],
        edition_count: 208,
        first_publish_year: 1967,
        language: [
          "jpn",
          "ita",
          "chi",
          "por",
          "spa",
          "eng",
          "fre",
          "ger",
        ],
      },
    ],
  }),
};

const searchNone: OlHttpFixture = {
  id: "search-none",
  path: "/search.json",
  query: {
    title: "zzqxqwnonexistentphrasebooknotfound",
    fields: SEARCH_FIELDS,
    limit: "20",
  },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ numFound: 0, start: 0, docs: [] }),
};

const workOl274505w: OlHttpFixture = {
  id: "work-ol274505w",
  path: "/works/OL274505W.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    key: "/works/OL274505W",
    type: { key: "/type/work" },
    title: "Cien años de soledad",
    authors: [
      { type: { key: "/type/author_role" }, author: { key: "/authors/OL27363A" } },
    ],
    first_publish_date: "1967",
    latest_revision: 61,
    revision: 61,
  }),
};

const workOl43416865w: OlHttpFixture = {
  id: "work-ol43416865w",
  path: "/works/OL43416865W.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    key: "/works/OL43416865W",
    type: { key: "/type/work" },
    title: "百年孤独",
    authors: [
      { type: { key: "/type/author_role" }, author: { key: "/authors/OL15389184A" } },
    ],
    latest_revision: 1,
    revision: 1,
  }),
};

const editionOl59138652m: OlHttpFixture = {
  id: "edition-ol59138652m",
  path: "/books/OL59138652M.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    type: { key: "/type/edition" },
    title: "百年孤独",
    publish_date: "1984",
    languages: [{ key: "/languages/chi" }],
    work_titles: ["Cien años de soledad"],
    other_titles: ["Bai nian gu du"],
    translated_from: [{ key: "/languages/spa" }],
    authors: [{ key: "/authors/OL15389184A" }],
    works: [{ key: "/works/OL43416865W" }],
    key: "/books/OL59138652M",
    latest_revision: 1,
    revision: 1,
  }),
};

const editionOl35346764m: OlHttpFixture = {
  id: "edition-ol35346764m",
  path: "/books/OL35346764M.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    type: { key: "/type/edition" },
    title: "Bai nian gu du",
    subtitle: "Cien años de soledad",
    publish_date: "1989",
    languages: [{ key: "/languages/chi" }],
    work_titles: ["Cien años de soledad"],
    by_statement: "Jiaxiya Ma'erkesi zhu",
    publishers: ["Shanghai yi wen chu ban she"],
    isbn_10: ["7532706907"],
    isbn_13: ["9787532706907"],
    key: "/books/OL35346764M",
    number_of_pages: 386,
    works: [{ key: "/works/OL274505W" }],
    latest_revision: 7,
    revision: 7,
  }),
};

const editionOl7353617m: OlHttpFixture = {
  id: "edition-ol7353617m",
  path: "/books/OL7353617M.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    type: { key: "/type/edition" },
    title: "Fantastic Mr. Fox",
    publish_date: "October 1, 1988",
    publishers: ["Puffin"],
    languages: [{ key: "/languages/eng" }],
    isbn_10: ["0140328726"],
    isbn_13: ["9780140328721"],
    number_of_pages: 96,
    key: "/books/OL7353617M",
    works: [{ key: "/works/OL45804W" }],
    latest_revision: 28,
    revision: 28,
  }),
};

const workOl45804w: OlHttpFixture = {
  id: "work-ol45804w",
  path: "/works/OL45804W.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    key: "/works/OL45804W",
    type: { key: "/type/work" },
    title: "Fantastic Mr Fox",
    latest_revision: 1,
    revision: 1,
  }),
};

const redirectOl45883w: OlHttpFixture = {
  id: "redirect-ol45883w",
  path: "/works/OL45883W.json",
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    location: "/works/OL45804W",
    key: "/works/OL45883W",
    type: { key: "/type/redirect" },
    latest_revision: 55,
    revision: 55,
  }),
};

const isbn302: OlHttpFixture = {
  id: "isbn-9780140328721-redirect",
  path: "/isbn/9780140328721.json",
  status: 302,
  contentType: "text/plain",
  location: "https://openlibrary.org/books/OL7353617M.json",
  body: "",
};

const missingWork404: OlHttpFixture = {
  id: "work-missing-json-404",
  path: "/works/OL0000000000W.json",
  status: 404,
  contentType: "application/json",
  body: '{"error":"notfound","key":"/works/OL0000000000W"}',
};

const missingEdition404: OlHttpFixture = {
  id: "book-missing-json-404",
  path: "/books/OL0000000000M.json",
  status: 404,
  contentType: "application/json",
  body: '{"error":"notfound","key":"/books/OL0000000000M"}',
};

const missingIsbn404Html: OlHttpFixture = {
  id: "isbn-missing-html-404",
  path: "/isbn/9787536692938.json",
  status: 404,
  contentType: "text/html; charset=utf-8",
  body:
    "<!DOCTYPE html><html><head><title>Not Found</title></head><body><h1>404 Not Found</h1></body></html>",
};

const editionsOl274505wP1: OlHttpFixture = {
  id: "editions-ol274505w-p1",
  path: "/works/OL274505W/editions.json",
  query: { offset: "0", limit: "2" },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    links: {
      self: "/works/OL274505W/editions.json?limit=2",
      work: "/works/OL274505W",
      next: "/works/OL274505W/editions.json?limit=2&offset=2",
    },
    size: 208,
    entries: [JSON.parse(editionOl35346764m.body)],
  }),
};

const editionsOl274505wP2: OlHttpFixture = {
  id: "editions-ol274505w-p2",
  path: "/works/OL274505W/editions.json",
  query: { offset: "2", limit: "2" },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    links: {
      self: "/works/OL274505W/editions.json?limit=2&offset=2",
      work: "/works/OL274505W",
    },
    size: 208,
    entries: [
      {
        type: { key: "/type/edition" },
        title: "Cien años de soledad",
        publish_date: "1995",
        publishers: ["Real academia española"],
        languages: [{ key: "/languages/spa" }],
        works: [{ key: "/works/OL274505W" }],
        key: "/books/OL62012175M",
      },
    ],
  }),
};

const editionsOl43416865wP1: OlHttpFixture = {
  id: "editions-ol43416865w-p1",
  path: "/works/OL43416865W/editions.json",
  query: { offset: "0", limit: "2" },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    links: {
      self: "/works/OL43416865W/editions.json?limit=2",
      work: "/works/OL43416865W",
    },
    size: 1,
    entries: [JSON.parse(editionOl59138652m.body)],
  }),
};

const editionsOl45804wEmpty: OlHttpFixture = {
  id: "editions-ol45804w-empty",
  path: "/works/OL45804W/editions.json",
  query: { offset: "0", limit: "2" },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    links: { self: "/works/OL45804W/editions.json?limit=2" },
    size: 0,
    entries: [],
  }),
};

const editionsEmpty: OlHttpFixture = {
  id: "editions-empty",
  path: "/works/OL9999999999W/editions.json",
  query: { offset: "0", limit: "2" },
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    links: { self: "/works/OL9999999999W/editions.json?limit=2" },
    size: 0,
    entries: [],
  }),
};

/** Full raw fixture corpus for Open Library contract tests. */
export const OL_HTTP_FIXTURES: readonly OlHttpFixture[] = [
  searchBaiNian,
  searchCien,
  searchNone,
  workOl274505w,
  workOl43416865w,
  editionOl59138652m,
  editionOl35346764m,
  editionOl7353617m,
  workOl45804w,
  redirectOl45883w,
  isbn302,
  missingWork404,
  missingEdition404,
  missingIsbn404Html,
  editionsOl274505wP1,
  editionsOl274505wP2,
  editionsOl43416865wP1,
  editionsOl45804wEmpty,
  editionsEmpty,
];

/** Find the fixture that matches a fetched absolute URL. */
export function findOpenLibraryFixture(
  url: string,
): OlHttpFixture | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "openlibrary.org") return undefined;
  return OL_HTTP_FIXTURES.find((fixture) => {
    if (fixture.path !== parsed.pathname) return false;
    if (fixture.query === undefined) return parsed.searchParams.size === 0;
    const params = fixture.query;
    for (const [name, value] of Object.entries(params)) {
      if (parsed.searchParams.get(name) !== value) return false;
    }
    // All fixture params matched; tolerate extra ordering keys on the wire.
    return Object.keys(params).length <= parsed.searchParams.size;
  });
}
