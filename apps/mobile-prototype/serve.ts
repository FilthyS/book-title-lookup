const root = new URL(".", import.meta.url);
const hostname = "127.0.0.1";
const port = 4173;

console.log(
  `Throwaway mobile prototype: http://${hostname}:${port}/?variant=A`,
);

Deno.serve({ hostname, port }, async (request) => {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    return new Response(await Deno.readTextFile(new URL("index.html", root)), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response("Not found", { status: 404 });
});
