window.__ModuleLoader__.load({
  id: "@jesse-lai/dsh-desktop-ui",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;

    const promptKitTheme = `
      :root {
        --dsh-desktop-content-width: 780px;
        --dsh-desktop-card-radius: 24px;
        --dsh-desktop-ease: cubic-bezier(.2, .8, .2, 1);
      }

      body {
        letter-spacing: -0.008em;
        text-rendering: optimizeLegibility;
      }

      [data-slot="sidebar"] {
        background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, transparent);
        border-right-color: color-mix(in srgb, var(--dsw-alias-border-l2) 72%, transparent);
      }

      [data-chat-flow] {
        width: min(var(--dsh-desktop-content-width), 100%);
        margin-inline: auto;
      }

      [data-chat-flow-kind] {
        animation: dsh-desktop-message-in 180ms var(--dsh-desktop-ease) both;
      }

      [data-composer-card] {
        border-radius: var(--dsh-desktop-card-radius) !important;
        border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 78%, transparent) !important;
        background: color-mix(in srgb, var(--dsw-specific-input-major) 94%, transparent) !important;
        box-shadow:
          0 1px 2px rgb(0 0 0 / 5%),
          0 10px 32px rgb(0 0 0 / 8%) !important;
        transition:
          border-color 160ms var(--dsh-desktop-ease),
          box-shadow 160ms var(--dsh-desktop-ease),
          transform 160ms var(--dsh-desktop-ease);
      }

      [data-composer-card]:focus-within {
        border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 42%, transparent) !important;
        box-shadow:
          0 1px 2px rgb(0 0 0 / 4%),
          0 14px 40px rgb(0 0 0 / 10%),
          0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent) !important;
      }

      [data-conversation-scroll] {
        scroll-behavior: smooth;
      }

      @keyframes dsh-desktop-message-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        [data-chat-flow-kind] { animation: none; }
        [data-conversation-scroll] { scroll-behavior: auto; }
      }
    `;

    function apply(ctx) {
      ctx.effect(() => {
        const existing = document.querySelector(
          'style[data-plugin="@jesse-lai/dsh-desktop-ui"]',
        );
        existing?.remove();

        const style = document.createElement("style");
        style.dataset.plugin = "@jesse-lai/dsh-desktop-ui";
        style.textContent = promptKitTheme;
        document.head.append(style);
        document.documentElement.dataset.dshDesktopUi = "prompt-kit";

        return () => {
          style.remove();
          delete document.documentElement.dataset.dshDesktopUi;
        };
      }, "dsh-desktop-ui: install Prompt Kit theme");
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  },
});
