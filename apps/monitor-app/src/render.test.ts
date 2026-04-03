import { describe, expect, it } from "vitest";
import { escapeHtml } from "./render";

describe("escapeHtml", () => {
  it("escapes task content before it is injected into markup", () => {
    expect(escapeHtml(`<script>alert("x")</script> & "q"`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;q&quot;"
    );
  });
});
