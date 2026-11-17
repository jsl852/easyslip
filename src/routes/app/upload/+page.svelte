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

  const reading = $derived(data.documents.filter((document) => document.status === "queued" || document.status === "processing").length);

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
      <p class="sub">Photograph a receipt, or choose one from the library. A photo with more than one slip is split, and each slip is read on its own. Reading continues if you leave this page.</p>
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
    <h2>Recent documents</h2>
    <p class="sub" aria-live="polite">
      {#if reading === 0}
        Nothing is waiting to be read.
      {:else}
        {reading} receipt{reading === 1 ? "" : "s"} still being read.
      {/if}
    </p>
    {#if data.documents.length === 0}
      <p class="sub">Nothing uploaded yet. A file named like <code>2024-03-02_cafe_86.50.jpg</code> can fill the manual fallback when no model key is set.</p>
    {:else}
      <div class="mobile-cards">
        {#each data.documents as document (document.id)}
          <article class="doc-card">
            <div class="doc-card-top">
              <span class="pill {document.status}">{statusLabel(document)}</span>
              {#if document.extractionSource}<span class="pill {document.extractionSource}">{sourceLabel(document.extractionSource)}</span>{/if}
              <span class="sub">{formatIsoDate(document.createdAt.toISOString().slice(0, 10))} · {document.txnType}</span>
            </div>
            <div class="file-name">{document.fileName}</div>
            {#if document.parentFileName}<p class="sub">From {document.parentFileName}</p>{/if}
            {#if statusDetail(document)}<p class="sub">{statusDetail(document)}</p>{/if}
            <div class="actions">
              {#if document.status === "extracted" && document.transactionId}
                <a class="button" href={`/app/transactions/${document.transactionId}`}>Preview</a>
              {/if}
              <a class="button secondary" href={`/app/documents/${document.id}/file`}>Receipt</a>
              {#if document.status === "failed" || document.status === "needs_split"}
                <form method="POST" action="?/retry">
                  <input type="hidden" name="id" value={document.id} />
                  <button class="secondary" type="submit">Retry</button>
                </form>
              {/if}
            </div>
          </article>
        {/each}
      </div>
      <div class="table-wrap mobile-table">
        <table>
          <thead><tr><th>When</th><th>File</th><th>Type</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {#each data.documents as document (document.id)}
              <tr>
                <td>{formatIsoDate(document.createdAt.toISOString().slice(0, 10))}</td>
                <td><a href={`/app/documents/${document.id}/file`}>{document.fileName}</a></td>
                <td>{document.txnType}</td>
                <td>
                  <span class="pill {document.status}">{statusLabel(document)}</span>
                  {#if document.extractionSource}<span class="pill {document.extractionSource}">{sourceLabel(document.extractionSource)}</span>{/if}
                  {#if document.parentFileName}<div class="sub">From {document.parentFileName}</div>{/if}
                  {#if statusDetail(document)}<div class="sub">{statusDetail(document)}</div>{/if}
                </td>
                <td>
                  {#if document.status === "extracted" && document.transactionId}
                    <a href={`/app/transactions/${document.transactionId}`}>Preview</a>
                  {/if}
                  {#if document.status === "failed" || document.status === "needs_split"}
                    <form method="POST" action="?/retry">
                      <input type="hidden" name="id" value={document.id} />
                      <button class="secondary" type="submit">Retry</button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
