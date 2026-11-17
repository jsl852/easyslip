<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { formatIsoDate } from "$lib/accounting/dates";
  import { prepareUploadFile } from "$lib/upload-prepare";
  import { addUploadFiles, isHeicFile } from "$lib/uploads";
  let { data, form } = $props();
  let files = $state<File[]>([]);
  let notice = $state<string | null>(null);
  let pending = $state(false);
  let preparing = $state(false);
  let prepareStatus = $state<string | null>(null);

  function isClientImage(file: File) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return false;
    return isHeicFile(file) || file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
  }
  let previewUrls = $state<string[]>([]);

  const reading = $derived(
    data.items.reduce((count, item) => {
      const receipts = item.kind === "expense" ? item.receipts : [item.receipt];
      return count + receipts.filter((receipt) => receipt.status === "queued" || receipt.status === "processing").length;
    }, 0)
  );

  $effect(() => {
    const urls = files.map((file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : ""));
    previewUrls = urls;
    return () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    };
  });

  $effect(() => {
    if (reading === 0) return;
    const timer = setInterval(() => {
      invalidateAll();
    }, 2000);
    return () => clearInterval(timer);
  });

  function statusLabel(document: { status: string; receiptCount: number | null }) {
    if ((document.status === "split" || document.status === "needs_split") && document.receiptCount) {
      return `${document.receiptCount} receipts found`;
    }
    if (document.status === "queued") return "Queued";
    if (document.status === "processing") return "Reading";
    if (document.status === "extracted") return "Ready";
    if (document.status === "failed") return "Failed";
    return document.status;
  }

  function statusDetail(document: { status: string; error: string | null }) {
    if (document.status === "split") return "Each slip is listed on its own. Open each one to review it.";
    return document.error;
  }

  function sourceLabel(source: string | null) {
    if (source === "stub") return "AI fallback";
    if (source === "xai") return "AI";
    return "";
  }

  async function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const list = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (list.length === 0) return;
    preparing = true;
    prepareStatus = null;
    try {
      const prepared: File[] = [];
      const imageCount = list.filter(isClientImage).length;
      let seen = 0;
      for (const file of list) {
        if (isClientImage(file)) {
          seen += 1;
          prepareStatus = imageCount > 1 ? `Compressing photos… ${seen} of ${imageCount}` : "Compressing photos…";
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        prepared.push(await prepareUploadFile(file));
      }
      const result = addUploadFiles(files, prepared);
      files = result.files;
      notice = result.message;
    } finally {
      preparing = false;
      prepareStatus = null;
    }
  }

  function removeFile(index: number) {
    files = files.filter((_, i) => i !== index);
    notice = null;
  }

  const queueLabel = $derived(
    preparing
      ? (prepareStatus ?? "Adding files…")
      : pending
        ? "Queuing…"
        : files.length === 0
          ? "Queue receipt"
          : `Queue ${files.length} receipt${files.length === 1 ? "" : "s"}`
  );
</script>

<div class="upload-page">
  <div class="page-head">
    <div>
      <h1>Upload</h1>
      <p class="sub">Photograph a receipt, or choose one from the library. A photo with more than one slip is split, then slips from the same purchase are booked once. Reading continues if you leave this page.</p>
    </div>
  </div>

  {#if form?.message}<p class="callout">{form.message}</p>{/if}
  {#if notice}<p class="callout">{notice}</p>{/if}
  {#if data.accounts.length === 0}
    <p class="callout bad">Add an active settlement account before uploading. Bank, cash, card, and employee cash bands can receive a batch.</p>
  {:else}
    <form
      method="POST"
      action="?/upload"
      enctype="multipart/form-data"
      class="card stack"
      use:enhance={({ formData, cancel }) => {
        if (files.length === 0) {
          notice = "Take a photo or choose a file first.";
          cancel();
          return;
        }
        formData.delete("files");
        for (const file of files) formData.append("files", file);
        pending = true;
        return async ({ result, update }) => {
          pending = false;
          if (result.type === "success") {
            files = [];
            notice = null;
          }
          await update();
        };
      }}
    >
      <div class="fields two">
        <label>
          <span>Transaction type</span>
          <select name="txnType">
            <option value="expense">Expense</option>
            <option value="purchase">Purchase</option>
            <option value="sales">Sales</option>
          </select>
        </label>
        <label>
          <span>Settlement account</span>
          <select name="settlementAccountId">
            {#each data.accounts as account (account.id)}
              <option value={account.id}>{account.code} {account.name}</option>
            {/each}
          </select>
        </label>
      </div>
      <div class="file-choices">
        <label class="file-choice">
          <input name="files" type="file" accept="image/*" capture="environment" disabled={preparing} onchange={onPick} />
          <span class="file-choice-kicker">Camera</span>
          <span class="file-choice-title">Take photo</span>
          <span class="file-choice-hint">Opens the rear camera</span>
        </label>
        <label class="file-choice file-choice-secondary">
          <input name="files" type="file" accept="image/*,application/pdf" multiple disabled={preparing} onchange={onPick} />
          <span class="file-choice-kicker">Library</span>
          <span class="file-choice-title">Photo library or file</span>
          <span class="file-choice-hint">JPEG, PNG, WebP, GIF, or PDF</span>
        </label>
      </div>
      {#if prepareStatus}<p class="sub" aria-live="polite">{prepareStatus}</p>{/if}
      {#if files.length}
        <ul class="picked">
          {#each files as file, index (`${file.name}-${file.size}-${file.lastModified}-${index}`)}
            <li>
              {#if previewUrls[index]}
                <img alt="" src={previewUrls[index]} />
              {:else}
                <span class="picked-file">PDF</span>
              {/if}
              <span class="picked-name">{file.name}</span>
              <button class="secondary" type="button" onclick={() => removeFile(index)}>Remove</button>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="sub"><a class="inline-action" href="/app/transactions/new">Enter a line without a file</a></p>
      <div class="actions upload-dock">
        <button disabled={pending || preparing}>{queueLabel}</button>
      </div>
    </form>
  {/if}

  <section style="margin-top: 1rem;">
    <h2>Recent expenses</h2>
    <p class="sub" aria-live="polite">
      {#if reading === 0}
        Nothing is waiting to be read.
      {:else}
        {reading} receipt{reading === 1 ? "" : "s"} still being read.
      {/if}
    </p>
    {#if data.items.length === 0}
      <p class="sub">Nothing uploaded yet. A file named like <code>2024-03-02_cafe_86.50.jpg</code> can fill the manual fallback when no model key is set.</p>
    {:else}
      <div class="mobile-cards">
        {#each data.items as item (item.kind === "expense" ? item.id : item.receipt.id)}
          {#if item.kind === "expense"}
            <article class="doc-card">
              <div class="doc-card-top">
                <span class="pill {item.reviewStatus}">{item.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span>
                {#if item.extractionSource}<span class="pill {item.extractionSource}">{sourceLabel(item.extractionSource)}</span>{/if}
                <span class="sub">{formatIsoDate(item.txnDate)} · {item.receipts.length} receipt{item.receipts.length === 1 ? "" : "s"}</span>
              </div>
              <a class="file-name" href={`/app/transactions/${item.id}`}>{item.description}</a>
              <ul class="clean">
                {#each item.receipts as receipt (receipt.id)}
                  <li>
                    <a href={`/app/documents/${receipt.id}/file`}>{receipt.fileName}</a>
                    · {statusLabel(receipt)}
                    {#if receipt.status === "failed" || receipt.status === "needs_split"}
                      <form method="POST" action="?/retry">
                        <input type="hidden" name="id" value={receipt.id} />
                        <button class="secondary" type="submit">Retry</button>
                      </form>
                    {/if}
                  </li>
                {/each}
              </ul>
              <div class="actions">
                <a class="button" href={`/app/transactions/${item.id}`}>Open expense</a>
              </div>
            </article>
          {:else}
            {@const receipt = item.receipt}
            <article class="doc-card">
              <div class="doc-card-top">
                <span class="pill {receipt.status}">{statusLabel(receipt)}</span>
                {#if receipt.extractionSource}<span class="pill {receipt.extractionSource}">{sourceLabel(receipt.extractionSource)}</span>{/if}
                <span class="sub">{formatIsoDate(receipt.createdAt.slice(0, 10))}</span>
              </div>
              <div class="file-name">{receipt.fileName}</div>
              {#if receipt.parentFileName}<p class="sub">From {receipt.parentFileName}</p>{/if}
              {#if statusDetail(receipt)}<p class="sub">{statusDetail(receipt)}</p>{/if}
              <div class="actions">
                <a class="button secondary" href={`/app/documents/${receipt.id}/file`}>Receipt</a>
                {#if receipt.status === "failed" || receipt.status === "needs_split"}
                  <form method="POST" action="?/retry">
                    <input type="hidden" name="id" value={receipt.id} />
                    <button class="secondary" type="submit">Retry</button>
                  </form>
                {/if}
              </div>
            </article>
          {/if}
        {/each}
      </div>
      <div class="table-wrap mobile-table">
        <table>
          <thead><tr><th>When</th><th>Expense</th><th>Receipts</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {#each data.items as item (item.kind === "expense" ? item.id : item.receipt.id)}
              {#if item.kind === "expense"}
                <tr>
                  <td>{formatIsoDate(item.txnDate)}</td>
                  <td><a href={`/app/transactions/${item.id}`}>{item.description}</a></td>
                  <td>
                    {#each item.receipts as receipt (receipt.id)}
                      <div><a href={`/app/documents/${receipt.id}/file`}>{receipt.fileName}</a></div>
                    {/each}
                  </td>
                  <td>
                    <span class="pill {item.reviewStatus}">{item.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span>
                    {#if item.groupConfidence}<div class="sub">Grouped at {Math.round(Number(item.groupConfidence) * 100)}%</div>{/if}
                  </td>
                  <td><a href={`/app/transactions/${item.id}`}>Open</a></td>
                </tr>
              {:else}
                <tr>
                  <td>{formatIsoDate(item.receipt.createdAt.slice(0, 10))}</td>
                  <td>{item.receipt.fileName}</td>
                  <td><a href={`/app/documents/${item.receipt.id}/file`}>Receipt</a></td>
                  <td>
                    <span class="pill {item.receipt.status}">{statusLabel(item.receipt)}</span>
                    {#if statusDetail(item.receipt)}<div class="sub">{statusDetail(item.receipt)}</div>{/if}
                  </td>
                  <td>
                    {#if item.receipt.status === "failed" || item.receipt.status === "needs_split"}
                      <form method="POST" action="?/retry">
                        <input type="hidden" name="id" value={item.receipt.id} />
                        <button class="secondary" type="submit">Retry</button>
                      </form>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
