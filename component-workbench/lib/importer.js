'use strict';

const path = require('node:path');
const { LIMITS, SCHEMA } = require('./constants');
const { fail } = require('./errors');
const { readLimited, parseJsonBytes, sha256, nonBlank, decodeUtf8, sameFile } = require('./util');
const { validateCandidate, hydrateAndVerifyPayload } = require('./validator');

function mediaTypeForExtension(extension) {
  if (extension === '.txt') return 'text/plain';
  if (extension === '.json') return 'application/json';
  if (extension === '.pdf') return 'application/pdf';
  return null;
}

function ensureText(bytes, label) {
  const text = decodeUtf8(bytes, label);
  if (Buffer.byteLength(text, 'utf8') > LIMITS.EXTRACTED_TEXT_BYTES) fail('EXTRACTED_TEXT_TOO_LARGE', `${label} exceeds extracted-text limit`);
  return text;
}

async function extractPdfText({ sourceBytes, sourcePath, pdfTextPath, pdfTextExtractor }) {
  if (sourceBytes.subarray(0, 5).toString('ascii') !== '%PDF-') fail('INVALID_PDF_SIGNATURE', 'A .pdf source must start with a PDF signature');

  if (pdfTextPath) {
    if (sameFile(sourcePath, pdfTextPath)) fail('PDF_TEXT_EQUALS_SOURCE', 'External PDF text must be a separate regular UTF-8 text file');
    const bytes = readLimited(pdfTextPath, LIMITS.EXTRACTED_TEXT_BYTES, 'EXTRACTED_TEXT_TOO_LARGE');
    const text = ensureText(bytes, 'External PDF text');
    return {
      text,
      descriptor: {
        mode: 'EXTERNAL_TEXT_FILE',
        extractorId: 'caller-supplied-text',
        extractorVersion: '1',
        outputSha256: sha256(bytes),
        safety: 'DATA_ONLY_NO_MODULE_LOADING'
      }
    };
  }

  if (pdfTextExtractor !== undefined) {
    if (typeof pdfTextExtractor !== 'function') fail('INVALID_PDF_EXTRACTOR', 'pdfTextExtractor must be a caller-supplied function');
    const result = await pdfTextExtractor(Buffer.from(sourceBytes), Object.freeze({ fileName: path.basename(sourcePath) }));
    if (!result || typeof result !== 'object' || typeof result.text !== 'string') {
      fail('INVALID_PDF_EXTRACTOR_RESULT', 'PDF extractor must return { text, extractorId, extractorVersion }');
    }
    if (!nonBlank(result.extractorId) || !nonBlank(result.extractorVersion)) {
      fail('INVALID_PDF_EXTRACTOR_RESULT', 'PDF extractor identity and version are required');
    }
    if (typeof result.text.isWellFormed === 'function' && !result.text.isWellFormed()) {
      fail('INVALID_UTF8', 'PDF extractor output contains an unpaired Unicode surrogate');
    }
    const bytes = Buffer.from(result.text, 'utf8');
    if (bytes.length > LIMITS.EXTRACTED_TEXT_BYTES) fail('EXTRACTED_TEXT_TOO_LARGE', 'PDF extractor output exceeds limit');
    return {
      text: ensureText(bytes, 'PDF extractor output'),
      descriptor: {
        mode: 'CALLER_CALLBACK',
        extractorId: result.extractorId,
        extractorVersion: result.extractorVersion,
        outputSha256: sha256(bytes),
        safety: 'CALLER_OWNS_EXECUTION_WORKBENCH_RECEIVES_TEXT_ONLY'
      }
    };
  }

  fail(
    'PDF_TEXT_EXTRACTOR_REQUIRED',
    'PDF parsing is intentionally not built in. Supply pre-extracted plain text with --pdf-text, or call the API with an explicit pdfTextExtractor callback.'
  );
}

async function prepareDraft(options) {
  options = options || {};
  const sourcePath = path.resolve(options.sourcePath || '');
  const documentVersion = options.documentVersion;
  if (!nonBlank(documentVersion)) fail('DOCUMENT_VERSION_REQUIRED', 'An explicit source document version is required');
  if (documentVersion.length > LIMITS.DOCUMENT_VERSION_LENGTH || /[\u0000-\u001f\u007f]/u.test(documentVersion)) {
    fail('INVALID_DOCUMENT_VERSION', `Document version must be at most ${LIMITS.DOCUMENT_VERSION_LENGTH} characters without control characters`);
  }

  const extension = path.extname(sourcePath).toLowerCase();
  const mediaType = mediaTypeForExtension(extension);
  if (!mediaType) {
    fail('UNSUPPORTED_SOURCE_TYPE', 'Only .txt, .json and .pdf source documents are accepted; source content is never executed');
  }

  const sourceBytes = readLimited(sourcePath, LIMITS.SOURCE_BYTES, 'SOURCE_TOO_LARGE');
  let extractedText;
  let extraction;
  if (extension === '.pdf') {
    const pdf = await extractPdfText({
      sourceBytes,
      sourcePath,
      pdfTextPath: options.pdfTextPath,
      pdfTextExtractor: options.pdfTextExtractor
    });
    extractedText = pdf.text;
    extraction = pdf.descriptor;
  } else {
    extractedText = ensureText(sourceBytes, 'Source document');
    extraction = {
      mode: extension === '.json' ? 'JSON_DATA' : 'PLAIN_TEXT',
      extractorId: 'builtin-utf8-decoder',
      extractorVersion: '1',
      outputSha256: sha256(Buffer.from(extractedText, 'utf8')),
      safety: 'PARSE_ONLY_NO_EVAL_NO_FUNCTION_NO_MODULE_LOADING'
    };
  }

  let candidate;
  if (options.candidatePath) {
    const candidatePath = path.resolve(options.candidatePath);
    if (sameFile(sourcePath, candidatePath)) {
      fail('CIRCULAR_SELF_EVIDENCE', 'Source evidence and candidate JSON must be separate files');
    }
    if (options.pdfTextPath && sameFile(candidatePath, options.pdfTextPath)) {
      fail('CIRCULAR_SELF_EVIDENCE', 'Extracted PDF text and candidate JSON must be separate files');
    }
    const candidateBytes = readLimited(candidatePath, LIMITS.CANDIDATE_BYTES, 'CANDIDATE_TOO_LARGE');
    if (sha256(candidateBytes) === sha256(sourceBytes) || sha256(candidateBytes) === extraction.outputSha256) {
      fail('CIRCULAR_SELF_EVIDENCE', 'Candidate bytes cannot also serve as their own evidence source');
    }
    candidate = parseJsonBytes(candidateBytes, 'Candidate');
  } else if (extension === '.json') {
    fail(
      'CANDIDATE_REQUIRED_FOR_JSON_SOURCE',
      'A JSON evidence source requires a separate --candidate file; an embedded candidate would be circular self-evidence'
    );
  } else {
    fail('CANDIDATE_REQUIRED', `${extension || 'This'} source requires a separate declarative candidate JSON file`);
  }

  validateCandidate(candidate);
  const source = {
    fileName: path.basename(sourcePath),
    mediaType,
    sha256: sha256(sourceBytes),
    documentVersion: documentVersion.trim(),
    extraction
  };
  const payload = hydrateAndVerifyPayload(
    { deviceClass: candidate.deviceClass, partVariant: candidate.partVariant },
    { ...source, extractedText, pages: extractedText.split('\f') }
  );
  return {
    candidateSchemaVersion: SCHEMA.CANDIDATE,
    recordId: candidate.recordId,
    source,
    payload
  };
}

module.exports = { prepareDraft, extractPdfText, mediaTypeForExtension };
