# Product Specification: Computational Life - True Primordial Soup

## 1. Overview

This application is an interactive React visualization of the research paper *"How Well-formed, Self-replicating Programs Emerge from Simple Interaction"* (arXiv:2406.19108). It simulates a "primordial soup" of randomly generated Brainfuck-variant (BFF) programs that interact, overwrite each other, and spontaneously evolve into self-replicating structures over millions of interactions.

## 2. Core Scientific Parameters (Strict Requirements)

To accurately reflect the paper, the simulation engine MUST adhere to these constants:

*   **POOL_SIZE:** `131,072` ($2^{17}$) programs in the primordial soup.
*   **PROG_SIZE:** `64` bytes per program.
*   **TAPE_SIZE:** `128` bytes (Interaction arena is precisely Block A + Block B concatenated).
*   **MAX_CYCLES:** `8,192` ($2^{13}$) operations allowed per interaction before termination.
*   **INSTRUCTIONS:** `"<>{}-+.,[]"`. All other byte values are interpreted as NO-OPs.
*   **True Epoch Definition:** 1 Epoch = `65,536` interactions (exactly `POOL_SIZE / 2` pairs, simulating one full pass over the entire pool).

## 3. System Architecture & Performance Engine

### 3.1 Initializing the Soup (Crypto Chunking)

The pool must be initialized with true random noise.

*   **Implementation Note:** The total pool size is ~8.4 MB (`131072 * 64` bytes). The browser's `window.crypto.getRandomValues()` API has a strict 65,536-byte limit per call. The initialization function *must* chunk the generation into safe blocks to avoid crashing the browser on load.

### 3.2 The BFF Interpreter

The interpreter must maintain local state for an interaction:

*   `ip` (Instruction Pointer)
*   `h0` (Head 0 / Data Pointer)
*   `h1` (Head 1 / Target Pointer)
*   Memory limits strictly wrap via modulo operations (`% TAPE_SIZE` or `% 256`).
*   Pointer `.` writes `h0` value to `h1` address. Pointer `,` writes `h1` value to `h0` address.
*   Loops `[` and `]` must correctly match nesting depths or halt immediately if unmatched.

### 3.3 Fast-Forward Engine (Time Machine)

To reach the required epochs (up to 10M+), the simulation requires a "Fast-Forward" engine separate from the visual React state.

*   **Zero-Allocation Loop:** The fast-forward engine must run a pure-JS inline execution loop that reads and writes directly to a shared `Uint8Array` pool reference. It should not allocate new memory arrays inside the `while` loop.
*   **UI Yielding:** Massive requests (e.g., 10M epochs) must be chunked (e.g., processing chunks of 50 epochs) and wrapped in `setTimeout` or `requestAnimationFrame` to yield execution back to the browser. This updates the progress bar and prevents the UI thread from hanging.
*   **Custom Simulation Input:** The UI provides a numeric input field to define a custom number of epochs to simulate (defaulting to 1,000), alongside preset buttons for 10 and 100 epochs, enabling flexible simulation lengths.
*   **Render Performance (Memoization):** Due to high-frequency state updates during visual simulation steps, heavy child components—specifically `EntropyChart` and static `HistoryItemView` timeline cards—are wrapped in `React.memo` to prevent redundant renders and maintain 60fps performance.

## 4. UI/UX and Data Visualization Requirements

### 4.1 Color and Layout Conventions

*   **Instruction Colors:** Distinct, bright colors for instructions (e.g., `<` Red, `.` Violet).
*   **NO-OP/Noise Cells:**
    
    *   Block A (Source/Left): Dark Slate (`#0f172a`).
    *   Block B (Target/Right): Slightly Lighter Slate (`#1e293b`). This clearly distinguishes the two programs when concatenated.
*   **Arena Grid:** The main interaction arena must be a precise 32-column grid (`gridTemplateColumns: repeat(32, 1fr)`). *Do not rely on default Tailwind `grid-cols-32` as it often requires custom configuration.*
*   **History Grid:** The timeline representations must be 8x8 grids to perfectly frame the 64-byte programs.

### 4.2 Pointer UI (Crucial UX fix)

*   Pointers (`ip`, `h0`, `h1`) **must not** use background opacity overlays, as this blends colors and obscures the underlying instruction type.
*   **Implementation:** Use CSS `box-shadow: inset ...` or explicit CSS borders (e.g., a yellow inset ring for `ip`, a cyan bottom border for `h0`, a fuchsia top border for `h1`).

### 4.3 Data Flow & History Timeline

*   The Right Column acts as a scrolling timeline.
*   The *top-most* item in this list must explicitly be the "LIVE ARENA PAIR" directly linked to the visual execution state on the left.
*   The subsequent 8 items are static historical snapshots of recently completed pairs.

### 4.4 Global Entropy Chart

*   **Metrics:** Must track two distinct values:
    
    1.  *Global Pool Entropy:* Shannon entropy of the full 8.4MB pool. Logged every 50 epochs. Expect a rock-solid line near `~7.9999` that only crashes during an extinction/replicator event (typically between 2k-16k epochs).
    2.  *Arena Sample Entropy:* Fluctuating dotted line representing the immediate 128-byte pair.
*   **Dynamic X-Axis:** The X-axis scales dynamically. It steps exponentially for early stages (`10 -> 100 -> 1,000 -> 10,000`) to keep early development focused, and transitions to linear growth in steps of `10,000` (`20,000 -> 30,000 -> ...`) for later stages to prevent excessive chart compression during very long runs.

## 5. Development and Build Instructions (Makefile Automation)

The project setup is complete, incorporating a structured Vite + React + TypeScript + Tailwind CSS v4 workspace. A `Makefile` is provided in the root to automate all development, build, and deployment workflows.

### 5.1 Setup & Installation

To install all required dependencies (including React 19, Vite 6, Tailwind v4, and Lucide icons), run:

```bash
make install
```

*Note: Make sure you have Node.js (v22+) active in your environment (e.g., via `nvm use 22` if using nvm).*

### 5.2 Local Development

To launch the local Vite development server with hot-reloading:

```bash
npm run dev
```

This will start the server (typically at `http://localhost:5173`) allowing you to run and debug the application interactively in the browser.

### 5.3 Compiling for Production

To compile and bundle the application into a highly optimized, standalone static web page:

```bash
make build
```

Vite will type-check the code using TypeScript (`tsc`) and compile the minified bundle into the `dist/` directory, containing:
*   `dist/index.html`: The single-page entry point.
*   `dist/assets/`: Combined and minified JavaScript and CSS assets.

### 5.4 Deployment (GitHub Pages)

Once your git repository is set up and linked to your GitHub remote, you can deploy the built production folder directly to GitHub Pages by running:

```bash
make deploy
```

This automates the deployment using `gh-pages`, pushing the contents of the `dist/` folder to your hosting branch.

### 5.5 Cleaning Build Artifacts

To clean up local build assets and the `node_modules` directory:

```bash
make clean
```

