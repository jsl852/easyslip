<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  let { data, children } = $props();
  let menu = $state<HTMLDetailsElement | null>(null);

  onMount(() => {
    const desktop = window.matchMedia("(min-width: 961px)");
    const openForDesktop = () => {
      if (desktop.matches && menu) menu.open = true;
    };
    openForDesktop();
    desktop.addEventListener("change", openForDesktop);
    return () => desktop.removeEventListener("change", openForDesktop);
  });

  const groups = [
    {
      label: "Work",
      links: [
        { href: "/app", label: "Overview" },
        { href: "/app/upload", label: "Upload" },
        { href: "/app/review", label: "Review", badge: true }
      ]
    },
    {
      label: "Books",
      links: [
        { href: "/app/transactions?type=expense", label: "Expenses" },
        { href: "/app/transactions?type=purchase", label: "Purchases" },
        { href: "/app/transactions?type=sales", label: "Sales" },
        { href: "/app/journal", label: "Journal" },
        { href: "/app/transactions/new", label: "Manual entry" }
      ]
    },
    {
      label: "Close",
      links: [
        { href: "/app/reports", label: "Reports" },
        { href: "/app/accounts", label: "Chart of accounts" },
        { href: "/app/categories", label: "Categories" },
        { href: "/app/rules", label: "Keyword rules" },
        { href: "/app/openings", label: "Opening balances" },
        { href: "/app/settings", label: "Company" }
      ]
    }
  ];

  const path = $derived($page.url.pathname);
  const ownDock = $derived(path === "/app/upload" || (/^\/app\/transactions\/[^/]+$/.test(path) && !path.endsWith("/new")));

  function current(href: string, pathname: string, search: string) {
    if (href === "/app") return pathname === "/app";
    const [target, query = ""] = href.split("?");
    if (target !== pathname) return false;
    if (!query) return search === "";
    return search === `?${query}`;
  }
</script>

<div class="app-shell" class:has-thumb={!ownDock} class:has-dock={ownDock}>
  <details class="side" bind:this={menu}>
    <summary>
      <span class="summary-brand"><span class="mark">E</span><span class="summary-name">{data.workspace.company.name}</span></span>
      <span class="summary-menu">Menu</span>
    </summary>
    <div class="side-body">
      <div class="side-top">
        <a class="wordmark brand" href="/app"><span class="mark">E</span>EasySlip</a>
        <div class="company-name">{data.workspace.company.name}</div>
        <div class="who">{data.workspace.userEmail}</div>
      </div>
      <nav class="nav-links" aria-label="Workspace">
        {#each groups as group (group.label)}
          <span class="group">{group.label}</span>
          {#each group.links as link (link.href)}
            <a href={link.href} aria-current={current(link.href, path, $page.url.search) ? "page" : undefined}>
              {link.label}
              {#if link.badge && data.counts.review > 0}<span class="badge">{data.counts.review}</span>{/if}
            </a>
          {/each}
        {/each}
      </nav>
      <form method="POST" action="/signout" style="margin-top: 1rem;">
        <input type="hidden" name="redirectTo" value="/" />
        <button class="secondary" type="submit">Sign out</button>
      </form>
    </div>
  </details>
  <main class="main" id="content">
    {@render children()}
  </main>
  {#if !ownDock}
    <nav class="thumb-nav" aria-label="Primary">
      <a href="/app" aria-current={path === "/app" ? "page" : undefined}>Overview</a>
      <a class="thumb-primary" href="/app/upload" aria-current={path === "/app/upload" ? "page" : undefined}>Upload</a>
      <a href="/app/review" aria-current={path === "/app/review" ? "page" : undefined}>
        Review
        {#if data.counts.review > 0}<span class="badge">{data.counts.review}</span>{/if}
      </a>
    </nav>
  {/if}
</div>
