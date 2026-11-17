<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data, form } = $props();
  let names = $state<string[]>([]);
  let pending = $state(false);

  $effect(() => {
    const waiting = data.documents.some((document) => document.status === "queued" || document.status === "processing");
    if (!waiting) return;
    const timer = setInterval(() => {
      invalidateAll();
    }, 2000);
    return () => clearInterval(timer);
  });
</script>

<div class="page-head">
  <div>
    <h1>Upload</h1>
    <p class="sub">Batch receipts, invoices, and bank slips. Processing continues after you leave this page, and resumes if it was interrupted.</p>
  </div>
</div>

{#if form?.message}<p class="callout">{form.message}</p>{/if}
{#if data.accounts.length === 0}
  <p class="callout bad">Add an active settlement account before uploading. Bank, cash, card, and employee cash bands can receive a batch.</p>
{:else}
  <form
    method="POST"
    action="?/upload"
    enctype="multipart/form-data"
    class="card stack"
    use:enhance={() => {
      pending = true;
      return async ({ update }) => {
        pending = false;
        names = [];
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
    <label>
      <span>Files (PDF or image, up to 20, 8 MB each)</span>
      <input
        name="files"
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
        onchange={(event) => {
          const list = event.currentTarget.files;
          names = list ? Array.from(list).map((file) => file.name) : [];
        }}
      />
    </label>
    {#if names.length}<p class="sub">{names.length} selected: {names.join(", ")}</p>{/if}
    <div class="actions">
      <button disabled={pending}>{pending ? "Queuing…" : "Queue batch"}</button>
      <a href="/app/transactions/new">Enter a line without a file</a>
    </div>
  </form>
{/if}

<section style="margin-top: 1rem;">
  <h2>Recent documents</h2>
  {#if data.documents.length === 0}
    <p class="sub">Nothing uploaded yet. A file named like <code>2024-03-02_cafe_86.50.jpg</code> can fill the manual fallback when no model key is set.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>File</th><th>Type</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each data.documents as document (document.id)}
            <tr>
              <td>{formatIsoDate(document.createdAt.toISOString().slice(0, 10))}</td>
              <td><a href={`/app/documents/${document.id}/file`}>{document.fileName}</a></td>
              <td>{document.txnType}</td>
              <td>
                <span class="pill {document.status}">{document.status}</span>
                {#if document.extractionSource}<span class="pill {document.extractionSource}">{document.extractionSource === "stub" ? "AI fallback" : "AI"}</span>{/if}
                {#if document.error}<div class="sub">{document.error}</div>{/if}
              </td>
              <td>
                {#if document.status === "failed"}
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
