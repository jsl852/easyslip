<script lang="ts">
  let { data } = $props();
</script>

<main class="landing">
  <header>
    <a class="wordmark brand" href="/"><span class="mark">E</span>EasySlip</a>
    {#if data.signedIn}
      <a class="button" href="/app">Open workspace</a>
    {:else}
      <a class="button" href="/login">Sign in</a>
    {/if}
  </header>
  <h1>From a stack of receipts to a balanced set of books.</h1>
  <p class="lede">
    EasySlip is a receipt-led workspace for Hong Kong SMEs. Upload receipts, invoices, and bank slips.
    The journal stays the source of truth. You correct the extraction, then download an Excel pack whose formulas roll up to a trial balance, balance sheet, and profit and loss.
  </p>
  <div class="steps">
    <article class="step"><span>01</span><strong>Sign in</strong>Google is the sign-in path. One company workspace per member.</article>
    <article class="step"><span>02</span><strong>Upload a batch</strong>Images and PDFs, marked as expense, purchase, or sales, against a bank, cash, or card account.</article>
    <article class="step"><span>03</span><strong>Review</strong>AI fills the first draft. You fix the date, amount, and category. Approval is explicit.</article>
    <article class="step"><span>04</span><strong>Export</strong>Journal lines for the period, with formula sheets for the statements.</article>
  </div>
  <p class="note">
    EasySlip keeps working papers. It does not file profits tax, connect a bank feed, run payroll, or track inventory.
    If the model key is unset, uploads still land in the review queue for manual entry.
    On a phone, add EasySlip to the Home Screen. Uploading a receipt opens the camera, and you can still choose a photo or PDF.
  </p>
</main>
