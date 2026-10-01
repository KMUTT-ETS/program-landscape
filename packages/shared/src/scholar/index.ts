export * from './quota';
export * from './merge';
export * from './parse';
export * from './name-match';
export * from './profile-identity';
export * from './html-text';
// NOT `./scrapingbee`. The transport does I/O and owns the API key, and this
// barrel is reachable from apps/web — a defect in the HTTP client used to 500
// the whole /profile page (2026-09-09). `./costs` carries the prices and the
// classifier, which is all a non-fetching caller needs. Import the transport by
// its own subpath: `@kku/shared/src/scholar/scrapingbee`.
export * from './costs';
export * from './credits';
export * from './disclosure';
export * from './author-names';
export * from './citation-detail';
