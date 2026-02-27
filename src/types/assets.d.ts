declare module '*.otf' {
  const url: string;
  export default url;
}

declare module '*.otf?url' {
  const url: string;
  export default url;
}
