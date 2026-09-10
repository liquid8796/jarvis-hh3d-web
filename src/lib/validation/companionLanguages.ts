type SourceFile = { path: string; content: string | null };

// Recognition improves consistency; it is not an allowlist of languages the
// model may choose. New languages can declare their own safe source paths.
const LANGUAGES: ReadonlyArray<{ name: string; extensions: string; aliases?: string }> = [
  { name: "Python", extensions: "py pyw pyi", aliases: "python2 python3 py" },
  { name: "JavaScript", extensions: "js jsx mjs cjs", aliases: "js jsx node nodejs node.js ecmascript" },
  { name: "TypeScript", extensions: "ts tsx mts cts", aliases: "ts tsx" },
  { name: "Rust", extensions: "rs", aliases: "rs" },
  { name: "Go", extensions: "go", aliases: "golang" },
  { name: "C", extensions: "c h" },
  { name: "C++", extensions: "cpp cxx cc h hpp hxx hh c++ h++", aliases: "cpp cxx cplusplus" },
  { name: "C#", extensions: "cs csx", aliases: "csharp c-sharp" },
  { name: "F#", extensions: "fs fsi fsx", aliases: "fsharp f-sharp" },
  { name: "Java", extensions: "java" },
  { name: "Kotlin", extensions: "kt kts" },
  { name: "Swift", extensions: "swift" },
  { name: "Objective-C", extensions: "m", aliases: "objectivec objc" },
  { name: "Objective-C++", extensions: "mm", aliases: "objectivecpp objcpp" },
  { name: "MATLAB", extensions: "m" },
  { name: "Octave", extensions: "m" },
  { name: "Ruby", extensions: "rb rake gemspec", aliases: "rb" },
  { name: "PHP", extensions: "php phtml" },
  { name: "Lua", extensions: "lua" },
  { name: "Luau", extensions: "luau" },
  { name: "Elixir", extensions: "ex exs" },
  { name: "Erlang", extensions: "erl hrl" },
  { name: "Clojure", extensions: "clj cljc" },
  { name: "ClojureScript", extensions: "cljs" },
  { name: "Haskell", extensions: "hs lhs" },
  { name: "Elm", extensions: "elm" },
  { name: "Gleam", extensions: "gleam" },
  { name: "Scala", extensions: "scala sc" },
  { name: "Dart", extensions: "dart" },
  { name: "Julia", extensions: "jl" },
  { name: "R", extensions: "r" },
  { name: "Zig", extensions: "zig" },
  { name: "Nim", extensions: "nim nims" },
  { name: "Crystal", extensions: "cr" },
  { name: "D", extensions: "d di" },
  { name: "OCaml", extensions: "ml mli" },
  { name: "Reason", extensions: "re rei", aliases: "reasonml" },
  { name: "ReScript", extensions: "res resi" },
  { name: "Racket", extensions: "rkt" },
  { name: "Scheme", extensions: "scm ss sld" },
  { name: "Common Lisp", extensions: "lisp lsp cl", aliases: "commonlisp" },
  { name: "Emacs Lisp", extensions: "el", aliases: "elisp emacslisp" },
  { name: "Perl", extensions: "pl pm" },
  { name: "Prolog", extensions: "pl pro" },
  { name: "Raku", extensions: "raku rakumod rakutest p6", aliases: "perl6" },
  { name: "Fortran", extensions: "f for f90 f95 f03 f08" },
  { name: "Ada", extensions: "adb ads" },
  { name: "Pascal", extensions: "pas pp" },
  { name: "COBOL", extensions: "cob cbl cpy" },
  { name: "V", extensions: "v" },
  { name: "Verilog", extensions: "v vh" },
  { name: "SystemVerilog", extensions: "sv svh" },
  { name: "Forth", extensions: "forth fth fs" },
  { name: "Odin", extensions: "odin" },
  { name: "Vala", extensions: "vala vapi" },
  { name: "Haxe", extensions: "hx" },
  { name: "PureScript", extensions: "purs" },
  { name: "Idris", extensions: "idr lidr" },
  { name: "Agda", extensions: "agda" },
  { name: "Lean", extensions: "lean" },
  { name: "Coq", extensions: "coq v" },
  { name: "Solidity", extensions: "sol" },
  { name: "Cairo", extensions: "cairo" },
  { name: "Move", extensions: "move" },
  { name: "GDScript", extensions: "gd" },
  { name: "Tcl", extensions: "tcl" },
  { name: "AWK", extensions: "awk", aliases: "gawk" },
  { name: "Shell", extensions: "sh bash zsh ksh", aliases: "bash zsh ksh posix shellscript" },
  { name: "Fish", extensions: "fish" },
  { name: "PowerShell", extensions: "ps1 psm1", aliases: "pwsh" },
  { name: "Nushell", extensions: "nu" },
  { name: "HTML", extensions: "html htm" },
  { name: "CSS", extensions: "css" },
  { name: "SCSS", extensions: "scss sass", aliases: "sass" },
  { name: "Less", extensions: "less" },
  { name: "Vue", extensions: "vue" },
  { name: "Svelte", extensions: "svelte" },
  { name: "Astro", extensions: "astro" },
  { name: "SQL", extensions: "sql" },
  { name: "WebAssembly", extensions: "wat wast", aliases: "wasm" },
];
const aliases = new Map<string, string>();
const extensionLanguages = new Map<string, string[]>();
for (const language of LANGUAGES) {
  const canonical = language.name.toLowerCase();
  aliases.set(canonical, canonical);
  for (const alias of language.aliases?.split(" ") ?? []) aliases.set(alias, canonical);
  for (const extension of language.extensions.split(" ")) extensionLanguages.set(extension, [...extensionLanguages.get(extension) ?? [], language.name]);
}

/** A comparison identity, including aliases; arbitrary language names remain valid. */
export function canonicalCompanionLanguage(language: string): string {
  const normalized = language.trim().toLowerCase().replace(/\s+/g, " ");
  return aliases.get(normalized) ?? aliases.get(normalized.replace(/\s+/g, "")) ?? normalized;
}

// These are execution boundaries, not a list of project topics. Model output is
// data: no helper here executes source, tools, commands, or arbitrary URLs.
export function isCompanionPathAllowed(path: string): boolean {
  if (!path || path.length > 240 || /[\\\x00-\x1f\x7f:%?#]/.test(path) || path.startsWith("/") || path.endsWith("/")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.trim() !== part || part.endsWith("."))) return false;
  return !parts.some((part) => /^(?:\.github|\.git|\.gitmodules|\.gitattributes|\.git-credentials|\.hg|\.svn|\.ssh|\.aws|\.oci|\.codex|\.claude|\.docker|\.netrc|\.npmrc|\.pypirc|\.yarnrc(?:\.yml)?|\.env(?:\..*)?|\.envrc|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|\.?credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(part)
    || /\.(?:pem|key|p12|pfx|ppk|jks|kdbx?)$/i.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part));
}

// Explicit declaration cannot promote documentation, configuration, assets,
// credential files, or workflows into source evidence.
const NON_SOURCE_EXTENSION = /\.(?:md|mdx|markdown|rst|txt|text|adoc|org|rtf|pdf|docx?|odt|json5?|jsonl|ya?ml|toml|ini|cfg|conf|config|properties|lock|env|csv|tsv|xml|svg|png|jpe?g|gif|webp|ico|bmp|avif|mp[34]|wav|ogg|webm|mov|woff2?|ttf|otf|eot|zip|gz|tar|tgz|7z|rar|bin|exe|dll|so|dylib|class|jar|wasm|map|log|sqlite3?|db)$/i;
const NON_SOURCE_NAME = /^(?:readme|changelog|changes|history|license|licence|copying|authors?|contributors?|code_of_conduct|contributing|security|notice|config|settings|manifest|package|tsconfig|dockerfile|compose|procfile)(?:[._-]|$)/i;

function canDeclareSource(path: string): boolean {
  if (!isCompanionPathAllowed(path)) return false;
  const name = path.split("/").at(-1)!;
  return !name.startsWith(".") && !NON_SOURCE_EXTENSION.test(name) && !NON_SOURCE_NAME.test(name);
}

function pathLanguages(path: string): string[] | undefined {
  const name = path.split("/").at(-1)!;
  return name.includes(".") ? extensionLanguages.get(name.split(".").at(-1)!.toLowerCase()) : undefined;
}

export function isCompanionSourcePath(path: string, declaredSourcePaths: readonly string[] = []): boolean {
  if (!isCompanionPathAllowed(path)) return false;
  return !!pathLanguages(path) || (canDeclareSource(path) && declaredSourcePaths.includes(path));
}

/** Recognized languages, dominant first. Text weighs by UTF-8 bytes; paths by count. */
export function inferCompanionLanguages(files: readonly (string | { path: string; content?: string | null })[]): string[] {
  const weights = new Map<string, number>();
  for (const file of files) {
    const path = typeof file === "string" ? file : file.path;
    if (!isCompanionSourcePath(path) || (typeof file !== "string" && file.content === null)) continue;
    // An ambiguous extension alone is not evidence of a particular language.
    const candidates = pathLanguages(path);
    const language = candidates?.length === 1 ? candidates[0] : undefined;
    if (!language) continue;
    const weight = typeof file !== "string" && typeof file.content === "string" ? Buffer.byteLength(file.content, "utf8") : 1;
    weights.set(language, (weights.get(language) ?? 0) + weight);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([language]) => language);
}

/** The declared paths identify substantive primary-language implementation. */
export function validateCompanionSourceDeclaration(language: string | undefined, sourcePaths: readonly string[] | undefined, files: readonly SourceFile[], requireDeclaration = false): void {
  if (requireDeclaration && !language?.trim()) throw new Error("Create requires an explicit primary programming language chosen by the model.");
  if (language !== undefined && (!language.trim() || language.length > 80 || /[\x00-\x1f\x7f]/.test(language))) throw new Error("Invalid primary programming language.");
  if (requireDeclaration && !sourcePaths?.length) throw new Error("Create requires sourcePaths identifying its primary-language implementation.");
  if (sourcePaths === undefined) return;
  if (!language?.trim() || sourcePaths.length > 24 || (requireDeclaration && !sourcePaths.length)) throw new Error("sourcePaths requires a primary programming language and at most 24 source files.");
  const seen = new Set<string>();
  for (const path of sourcePaths) {
    if (typeof path !== "string" || !isCompanionSourcePath(path, sourcePaths) || seen.has(path.toLowerCase())) throw new Error("sourcePaths must contain unique safe source files, not documentation, configuration, or assets.");
    seen.add(path.toLowerCase());
    const file = files.find((candidate) => candidate.path === path);
    if (!file || file.content === null || file.content.trim().length < 20) throw new Error("Each declared source path must match a substantive proposed source file.");
    const recognized = pathLanguages(path);
    if (recognized && !recognized.some((candidate) => canonicalCompanionLanguage(candidate) === canonicalCompanionLanguage(language))) throw new Error(`Declared primary language does not match recognized source file ${path}; choose the actual language or provide its implementation.`);
  }
}
