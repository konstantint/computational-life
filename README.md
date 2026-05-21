# Computational Life: Primordial Soup (arXiv:2406.19108)

An interactive React visualization of the research paper **"How Well-formed, Self-replicating Programs Emerge from Simple Interaction"** ([arXiv:2406.19108](https://arxiv.org/abs/2406.19108)).

This application simulates a "primordial soup" of randomly generated Brainfuck-variant (BFF) programs that interact, overwrite each other, and spontaneously evolve into self-replicating structures over millions of interactions—without any pre-programmed fitness function or external mutation.

---

## 🧪 Scientific Core Parameters

To accurately reflect the paper's experiment (specifically replicating the phase transition shown in Figure 3), the simulation engine strictly adheres to these scientific constants:

*   **Pool Size ($N$):** `131,072` ($2^{17}$) programs loaded in a flat, shared memory space.
*   **Program Size:** `64` bytes per program.
*   **Interaction Arena (Tape):** Precisely `128` bytes (concatenation of Program A and Program B).
*   **Max Cycles:** `8,192` ($2^{13}$) operations allowed per interaction before automatic termination.
*   **BFF Instruction Set:** `"<>{}-+.,[]"`. All other byte values are treated as NO-OPs.
*   **True Epoch:** Exactly `65,536` interactions (representing $N/2$ pairs, i.e., one full pass over the entire pool).

---

## ⚙️ How it Works

1.  **Initialization (Primordial Soup):**
    The 131,072 program slots (totaling ~8.4 MB) are initialized with pure cryptographic random noise (`window.crypto.getRandomValues()`).
2.  **Pair Selection:**
    Two programs (A and B) are picked at random from the huge pool.
3.  **Concatenation & Execution:**
    They are copied into a 128-byte interaction arena (`[Block A (64B) | Block B (64B)]`). An interpreter executes the combined code.
    *   The crucial operator is `.` (Copy $H_0 \rightarrow H_1$), allowing Program A (Source) to write values into the address space of Program B (Target). This allows *inter-block overwriting*.
4.  **Overwriting & Return:**
    Once execution halts (or reaches 8,192 cycles), the tape is split back into two 64-byte blocks and written back to overwrite the parent programs in the pool.
5.  **Spontaneous Evolution:**
    As interactions occur, "ancestor" programs that happen to write copy-loops onto their neighbors will begin replicating. Eventually, a well-formed replicator emerges and rapidly dominates the entire pool.
    *   **The Phase Transition**: In ~40% of runs, a self-replicating species spontaneously emerges, usually between **2,000 and 16,000 epochs**. When it does, the pool's Shannon entropy crashes dramatically as the replicator overwrites the noise.

---

## 🖥️ UI/UX Features

*   **Live Interactive Arena:** Watch individual program instructions execute step-by-step with a 32-column visual tape. Distinct, bright colors represent active BFF instructions while noise cells remain dark slate.
*   **Non-Intrusive Pointers:** Visual markers for IP (Instruction Pointer), H0 (Source Pointer), and H1 (Target Pointer) use inset shadows/borders so they don't blend or obscure the underlying instruction colors.
*   **Paired Program History (Timeline):** Shows static 8x8 grids of the 8 most recently completed interactions alongside their computed Shannon entropy. The top item is dynamically linked to the live, running arena.
*   **Global Entropy Chart:** Tracks the Shannon entropy of the entire 131,072 pool (measured every 50 epochs) plotted against a dynamically scaling X-axis alongside the immediate arena sample entropy.
*   **Time Machine (Native Fast-Forward):** To easily reach millions of interactions, a zero-allocation inline execution loop bypasses React state to run thousands of epochs in seconds. It yields back to the UI thread in chunks of 50 epochs to update progress and keep the browser responsive.

---

## 🛠️ Getting Started

This project is structured as a modern React onepager compiled using **Vite** and styled with **Tailwind CSS v4**.

### Prerequisites

Ensure you have **Node.js (v22+)** and **NPM** installed. If you are using `nvm`, you can load the correct version by running:
```bash
nvm use 22
```

### Commands (Makefile)

A helper `Makefile` is provided to automate setup, building, and deployment:

*   **Install Dependencies:**
    ```bash
    make install
    ```
    *(Installs React 19, Vite 6, Tailwind CSS v4, and Lucide Icons)*

*   **Run Local Development Server:**
    ```bash
    npm run dev
    ```
    *(Launches Vite development server)*

*   **Build for Production (HTML Onepager):**
    ```bash
    make build
    ```
    *Compiles and minifies the application into the `dist/` directory. The output is a highly optimized static web bundle.*

*   **Deploy to GitHub Pages:**
    ```bash
    make deploy
    ```
    *Pushes the built `dist/` folder to your GitHub Pages branch (`gh-pages`).*

*   **Clean Build Artifacts:**
    ```bash
    make clean
    ```

---

## 📖 Citation & Reference

If you are interested in the math and theory behind this simulation, please refer to the original paper:

> **How Well-formed, Self-replicating Programs Emerge from Simple Interaction**  
> Blaise Agüera y Arcas, Jyrki Alakuijala, James Evans, Ben Laurie, Alexander Mordvintsev, Eyvind Niklasson, Ettore Randazzo, Luca Versari  
> [arXiv:2406.19108 [cs.NE]](https://arxiv.org/abs/2406.19108)

