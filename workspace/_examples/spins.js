// A synchronous infinite loop. Nothing inside the process can interrupt it, so only the runner's
// hard kill (timeoutMs + 1000 ms) ends it. This is why every run gets its own child process.
export default async function () {
  for (;;) {
    // spin
  }
}
