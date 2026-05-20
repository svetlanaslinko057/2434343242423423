// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // ─── AUDIT-EXCEPTION: theme-independent SSR substrate ────────────
          // This style is emitted in the server-rendered HTML root, *before*
          // the React tree mounts and before `T` / CSS-variables are
          // injected into the document. Using `var(--t-bg)` here would not
          // resolve at first paint (the user-agent would fall back to white)
          // and cause a visible FOUC flash. Keeping a hardcoded substrate
          // value here is a documented architectural choice — the colour is
          // intentionally close to the dark substrate so the bridge from
          // SSR → React first paint is visually seamless. UX convention.
          backgroundColor: "#121211",
        }}
      >
        {children}
      </body>
    </html>
  );
}
