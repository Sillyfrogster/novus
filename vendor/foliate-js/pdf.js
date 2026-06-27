// Novus stub: PDF rendering is not enabled yet. foliate-js's real pdf.js pulls
// in pdf.js via a `new URL('vendor/pdfjs/...')` glob that the Vite bundler
// cannot statically resolve. We only open EPUBs for now, and view.js imports
// this module dynamically (only when opening a PDF), so this stub keeps the
// bundle clean. Restore the upstream pdf.js + a Vite-friendly loader to add PDF.
export const makePDF = async () => {
  throw new Error("PDF files are not supported in Novus yet.");
};
