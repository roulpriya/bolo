# Bolo development instructions

## Runtime and source layout

- Electron 43 runs the main process directly from `src/main/index.ts` using
  Node's native TypeScript type stripping. Main-process and shared TypeScript
  imports must use explicit `.ts` extensions.
- Keep Node/Electron-only code in `src/main/`, IPC schemas and cross-process
  types in `src/shared/`, and renderer-only code in `src/renderer/`.
- `src/preload/index.cjs` must remain CommonJS. Electron's sandboxed preload
  environment requires it; do not convert it to an ESM TypeScript preload.
- The renderer is built by Vite into `dist/renderer`. Do not add a TypeScript
  compile step for `src/main` or `src/shared`, and do not emit `dist/main`,
  `dist/shared`, or `dist/test`.
- The renderer is a multi-page Vite app: `src/renderer/app/index.html` (main
  composer/palette window) and `src/renderer/settings/index.html` (MCP
  settings window) are separate entries, each with its own `main.tsx`. There
  is no page at the dev server root — `npm run dev:electron`'s `wait-on`
  target must point at a real entry (`.../app/index.html`), not the bare
  `http://127.0.0.1:5173`, or Electron never launches.

## TypeScript and testing

- `tsconfig.app.json` and `tsconfig.test.json` are no-emit composite projects.
  Run `npm run check` after TypeScript changes.
- Unit tests run directly from TypeScript through Vitest. Add tests under
  `test/**/*.test.ts`, import `test` from `vitest`, and run `npm test`.
- Run `npm run build` to validate the Vite renderer bundle. A clean build must
  leave generated files only beneath `dist/renderer`.

## Process boundary

- Keep the preload API narrow. Never expose `ipcRenderer` to the renderer.
- Add renderer-to-main channels and Zod validation together in
  `src/shared/ipc.ts`; main-process handlers must validate both the sender and
  incoming arguments before invoking a service.

## UI component library and styling

- Interactive UI primitives live in `src/renderer/ui/` (`button.tsx`,
  `switch.tsx`, `segmented-control.tsx`, `text-field.tsx`, `text-area.tsx`,
  `disclosure.tsx`), built on `react-aria-components`. This is the only
  headless UI library used in the renderer — don't add Radix, Headless UI, or
  similar alongside it.
- Each component owns its appearance via a co-located plain CSS file
  (`button.css`, `switch.css`, …), not a CSS Module. Do not add `*.module.css`
  files or `import styles from "./x.module.css"` in this renderer — see the
  CSP note below. Screens configure a component's look through props
  (`variant`, `size`, `align`, `monospace`, `weight`, `bare`), not bespoke
  `className`s.
- No barrel `index.ts` in `src/renderer/ui/` (matches "avoid barrel files"
  below); import each component directly from its file, e.g.
  `import { Button } from "../../ui/button"`.
- Component CSS files are wired in via `@import` at the top of
  `src/renderer/styles.css`, which itself is loaded only through the static
  `<link>` tag in each `index.html` — never via a JS `import` inside a
  component file. Both `app/index.html` and `settings/index.html` enforce a
  strict CSP (`style-src 'self'`, no `unsafe-inline`). A JS `import` of *any*
  CSS (CSS Module or plain) makes Vite inject it as an inline `<style>` tag
  in dev mode, which that CSP blocks — production builds are unaffected
  since Vite extracts real `.css` files there, but `npm run dev` breaks. Do
  not loosen the CSP to work around this; keep new component styles
  CSP-safe via `@import` instead.
- Both `index.html` files give their stylesheet `<link>` the id
  `react-aria-pressable-style`. This pre-empts react-aria's `usePress` hook
  from injecting its own `<style id="react-aria-pressable-style">` at
  runtime (also blocked by the CSP above) — react-aria skips its own
  injection when an element with that id already exists. If a future
  react-aria version renames that internal id, this becomes a silent no-op
  (the touch-action enhancement stops applying), not a break — don't treat
  it as load-bearing beyond that.
- Form fields follow native macOS convention: no visible border, no
  background focus ring, plain text right-aligned within its row where it
  sits opposite a label (see `text-field.css`, `.tf-align-end`).


# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `npm exec -- ultracite fix`
- **Check for issues**: `npm exec -- ultracite check`
- **Diagnose setup**: `npm exec -- ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `npm exec -- ultracite fix` before committing to ensure compliance.
