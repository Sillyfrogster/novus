// foliate-js is vendored untyped JS. Importing view.js registers the
// <foliate-view> custom element as a side effect; we don't use its exports.
declare module "*/foliate-js/view.js" {
  const mod: unknown;
  export default mod;
}
