import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createEnv, closeAll } from "./helpers/load.mjs";

let env, opened;
function render(html) {
  opened = [];
  const box = env.document.createElement("div");
  env.window.HtmlSanitize.render(html, box, (u) => opened.push(u));
  return box;
}
before(() => {
  env = createEnv();
  env.load("html-sanitize.js");
});
after(() => env.close());

test("keeps whitelisted layout tags, drops script", () => {
  const box = render("<p>Hi <b>there</b></p><script>alert(1)</script>");
  assert.equal(box.innerHTML, "<p>Hi <b>there</b></p>");
});
test("drops img / style / iframe / form controls entirely (including their content)", () => {
  assert.equal(render('<img src="x" onerror="alert(1)"><style>p{}</style><iframe>x</iframe><form><input value="a"><button>b</button></form>').innerHTML, "");
});
test("strips every attribute (style, on*, id, class)", () => {
  const box = render('<p style="color:red" onclick="x()" id="a" class="b">t</p>');
  assert.equal(box.innerHTML, "<p>t</p>");
});
test("only https links survive; other hrefs become plain text", () => {
  const box = render('<a href="https://x.com/p">ok</a><a href="http://y.com/">bad</a><a href="javascript:alert(1)">js</a><a>none</a>');
  const links = box.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "https://x.com/p");
  assert.equal(box.textContent, "okbadjsnone");
});
test("clicking a link goes through openLink, not navigation", () => {
  const box = render('<a href="https://x.com/">ok</a>');
  const ev = new env.window.MouseEvent("click", { bubbles: true, cancelable: true });
  box.querySelector("a").dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(opened, ["https://x.com/"]);
});
test("unknown tags are unwrapped but their text is kept", () => {
  assert.equal(render("<custom><span>inner</span> tail</custom>").innerHTML, "<span>inner</span> tail");
});
test("nested lists and tables are rebuilt", () => {
  const html = "<ul><li>a<ul><li>b</li></ul></li></ul><table><tbody><tr><td>c</td></tr></tbody></table>";
  assert.equal(render(html).innerHTML, html);
});
test("comments and empty input", () => {
  assert.equal(render("<!-- c --><p>x</p>").innerHTML, "<p>x</p>");
  assert.equal(render("").innerHTML, "");
  assert.equal(render(null).innerHTML, "");
});
test("svg / math are dropped (no inline script vectors)", () => {
  assert.equal(render('<svg onload="x()"><a href="https://x">y</a></svg><math>z</math>').innerHTML, "");
});
test("container is cleared first", () => {
  const box = env.document.createElement("div");
  box.innerHTML = "<i>old</i>";
  env.window.HtmlSanitize.render("<p>new</p>", box, () => {});
  assert.equal(box.innerHTML, "<p>new</p>");
});

after(closeAll);
