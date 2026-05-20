import { describe, expect, it } from "vitest";

import { getRequiredCsp } from "../csp.js";

describe("getRequiredCsp", () => {
  it("returns empty directives when no adapters are described", () => {
    expect(getRequiredCsp()).toEqual({
      connectSrc: [],
      imgSrc: [],
      mediaSrc: [],
    });
  });

  it("adds data: to img-src and media-src when dataUrl is true", () => {
    const csp = getRequiredCsp({ dataUrl: true });
    expect(csp.imgSrc).toEqual(["data:"]);
    expect(csp.mediaSrc).toEqual(["data:"]);
    expect(csp.connectSrc).toEqual([]);
  });

  it("adds blob: to img-src and media-src when inMemory is true", () => {
    const csp = getRequiredCsp({ inMemory: true });
    expect(csp.imgSrc).toEqual(["blob:"]);
    expect(csp.mediaSrc).toEqual(["blob:"]);
    expect(csp.connectSrc).toEqual([]);
  });

  it("derives the s3 presign origin and reuses it for img/media when no publicHost is set", () => {
    const csp = getRequiredCsp({
      s3: { presignEndpoint: "https://uploads.example.com/sign" },
    });
    expect(csp.connectSrc).toEqual(["https://uploads.example.com"]);
    expect(csp.imgSrc).toEqual(["https://uploads.example.com"]);
    expect(csp.mediaSrc).toEqual(["https://uploads.example.com"]);
  });

  it("splits connect/img origins when publicHost differs from the presign endpoint", () => {
    const csp = getRequiredCsp({
      s3: {
        presignEndpoint: "https://api.example.com/sign",
        publicHost: "https://cdn.example.com",
      },
    });
    expect(csp.connectSrc).toEqual([
      "https://api.example.com",
      "https://cdn.example.com",
    ]);
    expect(csp.imgSrc).toEqual(["https://cdn.example.com"]);
    expect(csp.mediaSrc).toEqual(["https://cdn.example.com"]);
  });

  it("merges all adapter directives when several are configured", () => {
    const csp = getRequiredCsp({
      dataUrl: true,
      inMemory: true,
      s3: { presignEndpoint: "https://uploads.example.com/sign" },
    });
    expect(csp.connectSrc).toEqual(["https://uploads.example.com"]);
    expect(csp.imgSrc).toEqual([
      "data:",
      "blob:",
      "https://uploads.example.com",
    ]);
    expect(csp.mediaSrc).toEqual([
      "data:",
      "blob:",
      "https://uploads.example.com",
    ]);
  });

  it("supports multiple s3 entries", () => {
    const csp = getRequiredCsp({
      s3: [
        { presignEndpoint: "https://uploads-us.example.com/sign" },
        {
          presignEndpoint: "https://uploads-eu.example.com/sign",
          publicHost: "https://cdn-eu.example.com",
        },
      ],
    });
    expect(csp.connectSrc).toEqual([
      "https://uploads-us.example.com",
      "https://uploads-eu.example.com",
      "https://cdn-eu.example.com",
    ]);
    expect(csp.imgSrc).toEqual([
      "https://uploads-us.example.com",
      "https://cdn-eu.example.com",
    ]);
  });

  it("ignores malformed presign endpoints rather than throwing", () => {
    const csp = getRequiredCsp({
      s3: { presignEndpoint: "not a url" },
    });
    expect(csp.connectSrc).toEqual([]);
    expect(csp.imgSrc).toEqual([]);
  });

  it("freezes the returned object", () => {
    const csp = getRequiredCsp({ dataUrl: true });
    expect(Object.isFrozen(csp)).toBe(true);
    expect(Object.isFrozen(csp.imgSrc)).toBe(true);
  });
});
