<script lang="ts">
  import { formatCents, formatDecimal } from "$lib/accounting/format";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Journal</h1>
    <p class="sub">Each transaction is a debit and a credit. These lines are what the Excel pack copies onto the JL sheet.</p>
  </div>
</div>

<form class="filters" method="GET">
  <label><span>From</span><input type="date" name="from" value={data.from} /></label>
  <label><span>To</span><input type="date" name="to" value={data.to} /></label>
  <label>
    <span>Type</span>
    <select name="docType">
      <option value="">All</option>
      <option value="EJ" selected={data.docType === "EJ"}>EJ expense</option>
      <option value="PJ" selected={data.docType === "PJ"}>PJ purchase</option>
      <option value="SJ" selected={data.docType === "SJ"}>SJ sales</option>
    </select>
  </label>
  <button class="secondary" type="submit">Filter</button>
</form>

<p class={data.balanced ? "callout good" : "callout bad"}>
  Debits {formatCents(data.debit)} · Credits {formatCents(data.credit)} · {data.balanced ? "In balance" : "Out of balance"}
  {#if data.lines.length === 1000} · showing the first 1,000 lines{/if}
</p>

<div class="table-wrap" style="margin-top: 0.8rem;">
  <table>
    <thead>
      <tr><th>Date</th><th>Type</th><th>Description</th><th>Account</th><th>Category</th><th class="num">Debit</th><th class="num">Credit</th></tr>
    </thead>
    <tbody>
      {#each data.lines as line (line.id)}
        <tr>
          <td>{formatIsoDate(line.date)}</td>
          <td>{line.docTypeCode}</td>
          <td><a href={`/app/transactions/${line.transactionId}`}>{line.description}</a></td>
          <td>{line.accountCode} {line.accountName}</td>
          <td>{line.categoryName ?? ""}</td>
          <td class="num">{formatDecimal(line.debit)}</td>
          <td class="num">{formatDecimal(line.credit)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
