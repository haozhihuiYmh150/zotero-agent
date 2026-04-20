declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

// Extend Zotero types for our plugin preferences
declare namespace _ZoteroTypes {
  interface Prefs {
    PluginPrefsMap: {
      enable: boolean;
      input: string;
      "llm.provider": "doubao" | "openai" | "deepseek";
      "llm.apiKey": string;
      "llm.apiBase": string;
      "llm.model": string;
    };
  }
}
