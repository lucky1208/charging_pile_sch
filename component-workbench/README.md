# 元器件目录导入与审核工作台（P3）

这个目录实现安全、独立的元器件资料导入链路。它不修改现有绘图引擎，也不会根据上传内容生成或执行 JavaScript。所有输入都只按字节、UTF-8 文本或 JSON 数据处理；输出始终是 JSON 修订记录或受控目录 JSON。

核心边界：

- `DeviceClass` 表达设备类别与功能端口；
- `PartVariant` 表达厂家/型号，并可包含多个 `Connector`、多个 `FunctionalUnit`；
- `PhysicalTerminal` 表达真实端子；功能端口与物理端子必须双向引用；
- 每个实体和每个字段都是带 `confidence`、页码、bbox 和原文引文的声明；导入时由程序注入真实源文件 SHA-256、文档版本和引文 SHA-256；
- 生命周期只能按 `EXTRACTED_DRAFT → REVIEWED → APPROVED → DEPRECATED` 前进；
- 抽取、复核、批准（以及后续废弃）必须由规范化后互不相同的 actor 执行，防止同一身份自审自批；
- `UNKNOWN`、置信度低于 0.8、缺证据、悬空/单向端子映射都会阻断批准；
- 只有最新状态为 `APPROVED` 的记录可进入受控目录并标记 `autoWiringAllowed: true`；
- 每次状态变化新建只读 JSON 修订与 SHA-256 sidecar，修订间以前一版精确哈希串联，不覆盖旧版。
- 源文件、候选文件、修订文件和受控存储目录拒绝符号链接/目录联接，并在打开前后核对文件身份，发现换包或目录变化立即失败。

## 快速使用

Node.js 20 及以上，无第三方依赖。

```powershell
# 以下命令均在仓库根目录执行

node component-workbench\cli.js validate-candidate `
  --candidate component-workbench\examples\candidate.min.json

node component-workbench\cli.js extract `
  --source component-workbench\examples\sample-manual.txt `
  --candidate component-workbench\examples\candidate.min.json `
  --document-version REV-A `
  --store .\component-catalog-store `
  --actor extractor@example.com `
  --reason "首次结构化抽取"

node component-workbench\cli.js review `
  --store .\component-catalog-store --record example.contactor.dc100 `
  --actor reviewer@example.com --reason "逐字段核对原文和端子表"

node component-workbench\cli.js approve `
  --store .\component-catalog-store --record example.contactor.dc100 `
  --actor approver@example.com --reason "电气负责人批准进入受控目录"

node component-workbench\cli.js export `
  --store .\component-catalog-store --record example.contactor.dc100 `
  --out .\exports\controlled-catalog.json
```

导出文件若已存在会拒绝覆盖。修改资料时请创建新的 `recordId`，批准新版后再废弃旧版；不要改写历史修订。

`.json` 也可作为厂家证据源，但必须另传 `--candidate`。候选 JSON 不能同时充当自己的证据原文；相同文件、硬链接或逐字节副本都会以 `CIRCULAR_SELF_EVIDENCE` 阻断。

## PDF

CLI 故意不内置 PDF 解析、不加载用户给出的模块、也不运行外部命令。先用受控工具在工作台外生成纯文本，再传入：

```powershell
node component-workbench\cli.js extract `
  --source .\manual.pdf --pdf-text .\manual.extracted.txt `
  --candidate .\candidate.json --document-version 2026-07-15 `
  --store .\component-catalog-store --actor extractor@example.com `
  --reason "由受控 OCR/PDF 工具抽取"
```

未提供 `--pdf-text` 时明确返回 `PDF_TEXT_EXTRACTOR_REQUIRED`。应用集成也可通过 API 显式传入调用方拥有的 `pdfTextExtractor` callback；工作台只接收其纯文本结果。详见 [PDF 接口](references/pdf-extractor-interface.md)。

逐页文本以换页符 `\f` 分隔。每条引文只在其声明的 `page` 内查找；页码不存在或引文只出现在别页都会阻断。bbox 坐标仍需独立审核人对照原 PDF 核实，因为纯文本交接本身不能证明视觉坐标。

## 验证与测试

```powershell
node component-workbench\cli.js verify `
  --store .\component-catalog-store --record example.contactor.dc100

cd component-workbench
npm test
```

`verify` 会重新计算每版文件哈希、核对 sidecar、修订链、状态转换、角色分离和模型不变性。内置测试还覆盖路径穿越、Windows 保留名、符号链接/目录联接、读文件 TOCTOU、非法 UTF-8、JSON 重复键、循环自证、PDF 跨页伪引文、重哈希后的语义篡改、非规范修订以及上传 JS 不执行。

更多约束见 [数据模型与审核流程](references/model-and-workflow.md)；候选格式见 [JSON Schema](schemas/component-candidate.schema.json)。
