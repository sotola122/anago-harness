declare module '*.css?inline' {
  const css: string
  export default css
}

declare module '*.woff2' {
  const dataUrl: string
  export default dataUrl
}
