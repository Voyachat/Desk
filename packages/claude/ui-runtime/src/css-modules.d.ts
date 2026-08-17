/** CSS Modules typing shim for this package's .module.css imports. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
