(function (root) {
  'use strict';

  function csvCell(value) {
    const text = String(value ?? '');
    // Imported strings must not become executable spreadsheet formulas when a CSV is opened.
    const formulaLike = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(value);
    const safeText = formulaLike ? "'" + text : text;
    return '"' + safeText.replace(/"/g, '""') + '"';
  }

  root.Lucky645ExportUtils = Object.freeze({ csvCell });
})(typeof window !== 'undefined' ? window : globalThis);
