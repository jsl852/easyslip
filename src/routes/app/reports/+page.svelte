<script lang="ts">
  import Statements from "$lib/components/Statements.svelte";
  import { formatIsoDate } from "$lib/accounting/dates";
  let { data, form } = $props();
</script>

<div class="page-head">
  <div>
    <h1>Reports</h1>
    <p class="sub">
      Preview uses the same roll-up as the workbook. The Excel file puts values on JL and formulas on the account, type, trial balance, balance sheet, and profit and loss sheets.
      Yellow opening cells on TB are editable.
    </p>
  </div>
</div>

<form class="filters" method="GET">
  <label><span>From</span><input type="date" name="from" value={data.periodFrom} /></label>
  <label><span>To</span><input type="date" name="to" value={data.periodTo} /></label>
  <button class="secondary" type="submit">Preview</button>
</form>

<form method="POST" class="actions">
  <input type="hidden" name="from" value={data.periodFrom} />
  <input type="hidden" name="to" value={data.periodTo} />
  <button type="submit">Download Excel pack</button>
  <span class="sub">{data.lineCount} journal lines in this period.</span>
</form>
{#if form?.message}<p class="callout bad">{form.message}</p>{/if}

{#if data.statements}
  <div style="margin-top: 1rem;">
    <Statements statements={data.statements} />
  </div>
{:else}
  <p class="callout bad">The from date needs to be on or before the to date.</p>
{/if}

<section style="margin-top: 1.2rem;">
  <h2>Previous packs</h2>
  {#if data.jobs.length === 0}
    <p class="sub">No workbook has been generated yet.</p>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th>When</th><th>Period</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {#each data.jobs as job (job.id)}
            <tr>
              <td>{formatIsoDate(job.createdAt.toISOString().slice(0, 10))}</td>
              <td>{job.periodFrom} to {job.periodTo}</td>
              <td><span class="pill {job.status}">{job.status}</span>{#if job.error} {job.error}{/if}</td>
              <td>{#if job.status === "ready"}<a href={`/app/reports/${job.id}/download`}>{job.fileName}</a>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
