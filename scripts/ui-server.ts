/**
 * Local drag-and-drop UI for the generator.
 *   npm run ui
 * Serves scripts/ui.html on http://localhost:4321, accepts an uploaded video, runs
 * scripts/generate-short.ts with the chosen options and streams its progress to the page.
 */
import { spawn, exec, execFile, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOADS = path.join(ROOT, "uploads");
const OUT = path.join(ROOT, "out");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PORT = Number(process.env.PORT ?? 4321);

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

type Job = { id: string; log: string[]; done: boolean; error: string | null; output: string | null; child: ChildProcess; clients: Set<http.ServerResponse> };
const jobs = new Map<string, Job>();

const REMOTION_CLI = path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
const ffprobe = (args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(process.execPath, [REMOTION_CLI, "ffprobe", "-v", "error", ...args], { cwd: ROOT }, (_e, out) => resolve(out ?? "")),
  );

const ANSI = /\x1b\[[0-9;]*m/g;
const safeName = (s: string) => path.basename(s).replace(/[^\w.\- ]+/g, "_");
const MIME: Record<string, string> = { ".mp4": "video/mp4", ".html": "text/html; charset=utf-8", ".json": "application/json" };

function send(job: Job, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of job.clients) c.write(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function startJob(source: { file?: string; url?: string }, opts: Record<string, string | number | boolean>): Job {
  const id = Date.now().toString(36);
  const base = source.file ? path.basename(source.file, path.extname(source.file)).replace(/^\d+-/, "") : "youtube";
  const outName = `${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "short"}-${id}.mp4`;

  const args = [TSX_CLI, "scripts/generate-short.ts", ...(source.url ? ["--url", source.url] : ["--input", path.join(UPLOADS, source.file!)]), "--output", path.join(OUT, outName)];
  for (const [k, v] of Object.entries(opts)) {
    if (v === "" || v === undefined || v === false) continue;
    args.push(`--${k}`, String(v));
  }

  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, INIT_CWD: ROOT, FORCE_COLOR: "0" } });
  const job: Job = { id, log: [], done: false, error: null, output: null, child, clients: new Set() };
  jobs.set(id, job);

  const onData = (chunk: Buffer) => {
    for (const raw of chunk.toString().split(/\r?\n|\r/)) {
      const line = raw.replace(ANSI, "").trimEnd();
      if (!line) continue;
      job.log.push(line);
      if (job.log.length > 400) job.log.shift();
      send(job, "log", line);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    job.done = true;
    if (code === 0 && fs.existsSync(path.join(OUT, outName))) job.output = outName;
    else job.error = job.log.filter((l) => l.startsWith("✖")).pop()?.replace(/^✖\s*/, "") ?? `Generation failed (exit code ${code}).`;
    send(job, "done", { output: job.output, error: job.error });
    for (const c of job.clients) c.end();
    job.clients.clear();
  });
  return job;
}

function serveVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string, download: boolean) {
  const p = path.join(OUT, safeName(file));
  if (!fs.existsSync(p)) return void res.writeHead(404).end("Not found");
  const size = fs.statSync(p).size;
  const headers: Record<string, string | number> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${safeName(file)}"`;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    fs.createReadStream(p, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, "Content-Length": size });
    fs.createReadStream(p).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": MIME[".html"] }).end(fs.readFileSync(path.join(ROOT, "scripts", "ui.html")));
    } else if (req.method === "PUT" && url.pathname === "/upload") {
      const name = `${Date.now()}-${safeName(url.searchParams.get("name") ?? "video.mp4")}`;
      const ws = fs.createWriteStream(path.join(UPLOADS, name));
      req.pipe(ws);
      ws.on("finish", async () => {
        const file = path.join(UPLOADS, name);
        const streams = await ffprobe(["-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
        const dur = parseFloat(await ffprobe(["-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]));
        const info = { file: name, hasVideo: /video/.test(streams), hasAudio: /audio/.test(streams), duration: Number.isFinite(dur) ? dur : null };
        res.writeHead(200, { "Content-Type": MIME[".json"] }).end(JSON.stringify(info));
      });
      ws.on("error", () => res.writeHead(500).end());
    } else if (req.method === "POST" && url.pathname === "/generate") {
      const { file, url: link, options } = JSON.parse(await readBody(req));
      if (link) {
        if (!/^https?:\/\//i.test(link)) return void res.writeHead(400).end("Paste a full https:// video link");
      } else if (!file || !fs.existsSync(path.join(UPLOADS, safeName(file)))) return void res.writeHead(400).end("Unknown upload");
      const job = startJob(link ? { url: link } : { file: safeName(file) }, options ?? {});
      res.writeHead(200, { "Content-Type": MIME[".json"] }).end(JSON.stringify({ id: job.id }));
    } else if (req.method === "GET" && url.pathname.startsWith("/events/")) {
      const job = jobs.get(url.pathname.slice("/events/".length));
      if (!job) return void res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      for (const l of job.log) res.write(`event: log\ndata: ${JSON.stringify(l)}\n\n`);
      if (job.done) res.write(`event: done\ndata: ${JSON.stringify({ output: job.output, error: job.error })}\n\n`);
      job.clients.add(res);
      req.on("close", () => job.clients.delete(res));
    } else if (req.method === "POST" && url.pathname.startsWith("/cancel/")) {
      const job = jobs.get(url.pathname.slice("/cancel/".length));
      if (job && !job.done) {
        // Kill the whole tree (tsx → remotion → chrome) on Windows.
        if (process.platform === "win32") exec(`taskkill /pid ${job.child.pid} /T /F`);
        else job.child.kill("SIGTERM");
      }
      res.writeHead(204).end();
    } else if (req.method === "GET" && url.pathname.startsWith("/video/")) {
      serveVideo(req, res, decodeURIComponent(url.pathname.slice("/video/".length)), url.searchParams.has("download"));
    } else {
      res.writeHead(404).end("Not found");
    }
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\nShorts generator UI running at ${addr}  (Ctrl+C to stop)\n`);
  if (!process.env.NO_OPEN) {
    if (process.platform === "win32") exec(`start "" "${addr}"`);
    else exec(`${process.platform === "darwin" ? "open" : "xdg-open"} "${addr}"`);
  }
});
