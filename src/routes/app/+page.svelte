<script lang="ts">
  import { formatCents, formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data } = $props();

  function total(type: string) {
    return data.snapshot.totals.find((row) => row.type === type) ?? { count: 0, total: "0" };
  }
</script>

<div class="page-head">
  <div>
    <h1>Overview</h1>
    <p class="sub">{data.workspace.company.name} · {formatIsoDate(data.from)} to {formatIsoDate(data.today)}, Hong Kong dates.</p>
  </div>
  <a class="button" href="/app/upload">Upload a receipt</a>
</div>

<div class="stats">
  <article class="stat"><b>{data.snapshot.reviewCount}</b><span>Waiting for review</span></article>
  <article class="stat"><b>{data.snapshot.queuedCount}</b><span>Still extracting</span></article>
  <article class="stat"><b>{formatCents(data.netIncomeCents)}</b><span>Net income this month</span></article>
  <article class="stat"><b>{data.journalsBalanced ? "Balanced" : "Out"}</b><span>Period journal debits and credits</span></article>
</div>

<div class="stats" style="margin-top: 0.75rem;">
  {#each ["expense", "purchase", "sales"] as type (type)}
    <article class="stat">
      <b>{formatDecimal(total(type).total)}</b>
      <span>{total(type).count} {type}{total(type).count === 1 ? "" : "s"} this month</span>
    </article>
  {/each}
  <article class="stat">
    <b class={data.balanceCheckCents === 0 ? "" : "neg"}>{formatCents(data.balanceCheckCents)}</b>
    <span>Balance-sheet check</span>
  </article>
</div>

<section style="margin-top: 1.2rem;">
  <div class="page-head">
    <h2>Recent entries</h2>
    <a href="/app/review">Open the review queue</a>
  </div>
  {#if data.snapshot.recent.length === 0}
    <div class="card">
      <p>No journal entries yet. Upload a batch, or <a href="/app/transactions/new">post a cash line by hand</a>.</p>
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Category</th><th>Status</th><th class="num">Amount</th></tr></thead>
        <tbody>
          {#each data.snapshot.recent as row (row.id)}
            <tr>
              <td>{formatIsoDate(row.txnDate)}</td>
              <td>{row.type}</td>
              <td>
                <a href={`/app/transactions/${row.id}`}>{row.description}</a>
                {#if row.receiptCount > 1}<div class="sub">{row.receiptCount} receipts</div>{/if}
              </td>
              <td>{row.categoryName}</td>
              <td><span class="pill {row.reviewStatus}">{row.reviewStatus === "needs_review" ? "Needs review" : "Approved"}</span></td>
              <td class="num">{formatDecimal(row.amount)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
