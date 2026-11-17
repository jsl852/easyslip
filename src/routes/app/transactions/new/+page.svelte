<script lang="ts">
  import TransactionForm from "$lib/components/TransactionForm.svelte";
  let { data, form } = $props();
  const values = $derived(
    form?.values ?? {
      type: "expense",
      txnDate: data.today,
      merchant: "",
      description: "",
      amount: "",
      settlementAccountId: data.accounts[0]?.id ?? "",
      categoryId: data.categories.find((category) => category.name === "General expenses")?.id ?? data.categories[0]?.id ?? ""
    }
  );
</script>

<div class="page-head">
  <div>
    <h1>Manual entry</h1>
    <p class="sub">Post a cash or card line that has no file. It still creates a balanced pair of journal lines and waits in review.</p>
  </div>
</div>
{#if form?.message}<p class="callout bad">{form.message}</p>{/if}
{#if data.accounts.length === 0 || data.categories.length === 0}
  <p class="callout bad">You need an active settlement account and an active category before posting.</p>
{:else}
  <div class="card">
    <TransactionForm {values} accounts={data.accounts} categories={data.categories} />
  </div>
{/if}
