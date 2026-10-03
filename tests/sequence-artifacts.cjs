/* Optional artifact QA, NOT browser qualification. Uses resvg to rasterize
   frozen SVG frames, then exercises the actual app PNG/PDF/ZIP orchestration.
   PYTHONPATH must provide resvg_py, pymupdf, pypdf and Pillow. No production dependencies. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { environment, setup } = require("./harness.cjs");
const assert = require("node:assert/strict");
const out = path.resolve(process.argv[2] || "output/pdf/pass8-sequence");
fs.mkdirSync(out, { recursive: true });
const e = environment();
setup(e);
e.run(`
  $('#stages-panel').hidden=true;
  state.title='Build sequence QA'; view={x:0,y:0,z:1};
  const container=makeNode('container',330,150); container.w=730;container.h=400;container.x=0;container.y=0;container.text='System overview';
  a.x=60;a.y=100;a.text='Continuum';a.parentId=container.id;
  b.x=500;b.y=100;b.text='Orthanc';b.parentId=container.id;
  const c=makeNode('decision',350,280);c.text='AI models';c.parentId=container.id;
  const reverse=makeEdge(b.id,a.id);reverse.label='Response';
  const model=makeEdge(c.id,a.id);model.label='Input';
  edge.label='Request';
  const s1=addBuildStage('Overview'),s2=addBuildStage('Exchange'),s3=addBuildStage('AI models');
  assignBuildStage([a.id],s1);assignBuildStage([b.id],s2);assignBuildStage([c.id],s3);
  fitContainers();render();
  $('#sequence-scale').value='1'; $('#sequence-margin').value='32';
  $('#sequence-page').value='a4-landscape'; $('#sequence-json').checked=true;
`);
// Host-backed zero-delay timers only for this standalone integration run.
const nativeSet = setTimeout;
e.run("(fn)=>{setTimeout=fn}")(nativeSet);
e.run("(fn)=>{clearTimeout=fn}")(clearTimeout);
const artifacts = [];
e.run("(fn)=>{download=fn}")((name, bytes) => {
  fs.writeFileSync(path.join(out, name), Buffer.from(bytes));
  artifacts.push(name);
});
const renderer = `
import sys, struct, io, resvg_py
from PIL import Image
w,h=int(sys.argv[1]),int(sys.argv[2])
png=resvg_py.svg_to_bytes(svg_string=sys.stdin.buffer.read().decode('utf-8'),width=w,height=h)
im=Image.open(io.BytesIO(png)).convert('RGBA')
if im.size!=(w,h):
    raise RuntimeError('Unexpected rendered dimensions')
sys.stdout.buffer.write(struct.pack('<III',w,h,len(png))+png+im.tobytes())
`;
let calls = 0,
  freed = 0;
e.run("(fn)=>{rasterizeSVG=fn}")(async (svg, scale, size) => {
  const r = spawnSync(
    "python3",
    ["-c", renderer, String(size.w), String(size.h)],
    { input: svg, maxBuffer: 80 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const w = r.stdout.readUInt32LE(0),
    h = r.stdout.readUInt32LE(4),
    n = r.stdout.readUInt32LE(8);
  const png = r.stdout.subarray(12, 12 + n),
    rgba = new Uint8Array(r.stdout.subarray(12 + n));
  const index = ++calls;
  if (index <= 3) {
    fs.writeFileSync(path.join(out, `frame-${index}.svg`), svg);
    fs.writeFileSync(path.join(out, `frame-${index}.png`), png);
  }
  let height = h;
  return {
    canvas: {
      width: w,
      get height() {
        return height;
      },
      set height(v) {
        if (v === 0) freed++;
        height = v;
      },
      getContext: () => ({ getImageData: () => ({ data: rgba }) }),
      toBlob: (callback) => callback(new Blob([png], { type: "image/png" })),
    },
    scale,
  };
});

(async () => {
  const before = e.run("snapshot()"),
    history = e.run("history.length");
  await e.run("openSequence()");
  for (const format of ["png", "pdf", "combined"]) {
    e.document.querySelector("#sequence-format").value = format;
    // Distinct filename for each ZIP, while exercising the actual controller.
    e.run("(kind)=>{sequenceScene={...sequenceScene,title:'Build '+kind}}")(
      format,
    );
    await e.run("exportSequence()");
    assert.match(
      e.document.querySelector("#sequence-status").textContent,
      /^Downloaded/,
    );
  }
  assert.equal(calls, 9);
  assert.equal(freed, 9);
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), history);
  const verify = `
import sys,pathlib,zipfile,json,io,pymupdf
from pypdf import PdfReader
p=pathlib.Path(sys.argv[1]);result={}
for archive in p.glob('*.zip'):
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        manifest=json.loads(z.read('manifest.json'))
        assert len(manifest['stages'])==3
        assert [s['index'] for s in manifest['stages']]==[1,2,3]
        frames=[s['file'] for s in manifest['stages']]
        sizes=[]
        for i,f in enumerate(frames):
            data=z.read(f)
            if f.endswith('.pdf'):
                pdf=PdfReader(io.BytesIO(data));assert len(pdf.pages)==1
                sizes.append(list(pdf.pages[0].mediabox))
                im=pdf.pages[0].images[0];assert im.image.size==(manifest['width'],manifest['height'])
                doc=pymupdf.open(stream=data,filetype='pdf')
                doc[0].get_pixmap().save(str(p/('pdf-frame-'+str(i+1)+'.png')))
            else:
                assert data.startswith(b'\\x89PNG\\r\\n\\x1a\\n')
                im=pymupdf.Pixmap(data); sizes.append([im.width,im.height])
        assert sizes[0]==sizes[1]==sizes[2]
        result[archive.name]={'frames':len(frames),'files':z.namelist(),'sizes':sizes,'crc':'passed'}
pdf=PdfReader(p/'Build-combined-build.pdf');assert len(pdf.pages)==3
assert len({tuple(x.mediabox) for x in pdf.pages})==1
result['combined_pdf']={'pages':len(pdf.pages),'mediabox':list(pdf.pages[0].mediabox)}
print(json.dumps(result,indent=2))
`;
  const verified = spawnSync("python3", ["-c", verify, out], {
    encoding: "utf8",
  });
  if (verified.status !== 0) throw new Error(verified.stderr);
  const report = {
    when: new Date().toISOString(),
    source:
      "actual app export pipeline; resvg SVG raster adapter, MuPDF PDF renderer (not native browser)",
    calls,
    freed,
    artifacts,
    verification: JSON.parse(verified.stdout),
  };
  fs.writeFileSync(
    path.join(out, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
