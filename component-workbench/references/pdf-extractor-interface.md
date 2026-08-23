# PDF 外部文本提取接口

工作台不捆绑 OCR/PDF 库，也不根据 CLI 参数加载任意 Node 模块。这样可以防止“上传一个手册”演变成执行手册内容或执行不受控插件。

## CLI：纯文本交接

受控 PDF/OCR 工具在独立步骤产出 UTF-8 纯文本，工作台通过 `--pdf-text` 接收。记录中：

- `source.sha256` 始终是原始 PDF 字节的 SHA-256；
- `source.extraction.outputSha256` 是交接文本的 SHA-256；
- 每条证据的 `sourceSha256` 仍指向原始 PDF；
- 交接文本用 `\f` 分隔页面；引文必须出现在其 evidence 声明的页面中。

没有交接文本时返回 `PDF_TEXT_EXTRACTOR_REQUIRED`，不会悄悄跳过证据核验。

## Node API：调用方拥有的 callback

可信宿主应用可以显式传入 callback：

```js
const { prepareDraft } = require('../component-workbench/lib');

const draft = await prepareDraft({
  sourcePath: 'manual.pdf',
  candidatePath: 'candidate.json',
  documentVersion: 'REV-C',
  pdfTextExtractor: async (pdfBytes, metadata) => ({
    text: await trustedPdfService.extractText(pdfBytes),
    extractorId: 'company-pdf-service',
    extractorVersion: '4.2.1'
  })
});
```

callback 是宿主代码的一部分，不是从上传文件名、候选 JSON 或手册内容动态加载的。返回值必须只有字符串文本、非空 extractor ID 和版本。工作台会限制输出大小，并只把它当数据处理。

若外部服务还提供逐页 bbox，候选生成器应把页码和 bbox 写入每条声明的 evidence；工作台会独立核对页内引文、交接文本哈希和原始 PDF 哈希。纯文本不能证明 bbox 的视觉坐标，批准人仍须对照原 PDF 核实。
