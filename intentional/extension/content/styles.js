globalThis.__intentionalStyles = `
    :host {
      all: initial;
      color-scheme: light;
    }
    * {
      box-sizing: border-box;
    }
    dialog {
      border: 0;
      padding: 0;
      background: transparent;
      max-width: none;
      max-height: none;
      width: 100vw;
      height: 100dvh;
      margin: 0;
      inset: 0;
      color: #24352e;
      font:
        15px/1.5 -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }
    dialog::backdrop {
      background: #f4f5f0;
    }
    dialog[open] {
      display: grid;
      place-items: center;
      background: #f4f5f0;
      overflow: auto;
    }
    .card {
      width: min(420px, calc(100vw - 32px));
      padding: 24px;
      border: 1px solid #dce2d7;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 16px 60px #24352e0a;
      max-height: calc(100dvh - 24px);
      overflow: auto;
    }
    .brand {
      color: #244c3d;
      font-size: 14px;
      font-weight: 650;
      margin-bottom: 0;
    }
    h1 {
      font-size: 26px;
      line-height: 1.2;
      letter-spacing: -0.7px;
      margin: 10px 0 12px;
    }
    p {
      color: #6b766f;
      margin: 0 0 20px;
    }
    .reminder { color: #455348; overflow-wrap: anywhere; }
    .scope { color: #6b766f; font-size: 12px; margin: 14px 0; overflow-wrap: anywhere; }
    .previous-reason { font-size: 12px; color: #6b766f; border-left: 2px solid #dce2d7; padding-left: 10px; margin: 16px 0; overflow-wrap: anywhere; }
    .override-label { color: #8a5626; font-size: 12px; font-weight: 650; margin: 16px 0; }
    .reset { text-align: center; margin: 14px 0 0; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin: 16px 0 7px;
    }
    textarea,
    input {
      width: 100%;
      font: inherit;
      color: inherit;
      border: 1px solid #ccd5ca;
      border-radius: 9px;
      padding: 11px;
      background: #fff;
    }
    textarea {
      resize: vertical;
      min-height: 72px;
      max-height: 140px;
    }
    input {
      max-width: 110px;
    }
    textarea:focus,
    input:focus {
      outline: 2px solid #244c3d;
      outline-offset: 2px;
    }
    .message-note { font-weight: 700; }
    .gate-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
    .gate-site { color: #69756c; font-size: 12px; overflow-wrap: anywhere; text-align: right; }
    .reminder { margin-top: 10px; margin-bottom: 18px; font-size: 16px; line-height: 1.5; }
    .reason-hints { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; }
    .reason-hints[hidden] { display: none; }
    .reason-hints .reason-hint { width: auto; padding: 5px 10px; font-size: 14px; font-weight: 400; color: #41594b; background: #f1f5ef; border: 1px solid #d8e0d4; border-radius: 6px; margin: 0; }
    .time-row { display: flex; align-items: center; gap: 12px; }
    .time-input { position: relative; width: 112px; flex: none; }
    .time-input input { max-width: none; padding-right: 40px; appearance: textfield; }
    .time-input input::-webkit-inner-spin-button, .time-input input::-webkit-outer-spin-button { appearance: none; margin: 0; }
    .time-input span { position: absolute; right: 11px; top: 50%; transform: translateY(-50%); color: #69756c; font-size: 12px; pointer-events: none; }
    .time-max { color: #69756c; font-size: 12px; }
    .hint {
      font-size: 12px;
      margin: 8px 0 20px;
    }
    button {
      font: inherit;
      cursor: pointer;
      border: 0;
      border-radius: 9px;
      padding: 11px 18px;
      background: #244c3d;
      color: #fff;
      font-weight: 600;
    }
    button:hover {
      background: #19392c;
    }
    button:focus-visible {
      outline: 2px solid #244c3d;
      outline-offset: 3px;
    }
    .primary {
      width: 100%;
      margin-top: 18px;
    }
    .secondary {
      display: block;
      width: 100%;
      background: transparent;
      color: #667369;
      margin-top: 8px;
    }
    .secondary:hover {
      background: #eff2eb;
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .error {
      color: #a54535;
      font-size: 13px;
      margin: 10px 0 0;
    }
    .chip {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #fff;
      color: #244c3d;
      border: 1px solid #d7dfd4;
      box-shadow: 0 4px 18px #00000012;
      border-radius: 30px;
      padding: 8px 13px;
      font-size: 12px;
      font-weight: 600;
      max-width: calc(100vw - 32px);
    }
    .toast {
      position: fixed;
      right: 16px;
      top: 60px;
      z-index: 2147483647;
      width: min(310px, calc(100vw - 32px));
      padding: 16px 18px;
      background: #244c3d;
      color: #fff;
      border-radius: 12px;
      font:
        14px/1.5 -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      box-shadow: 0 8px 30px #0002;
    }
    .toast button {
      float: right;
      background: transparent;
      padding: 0 0 0 12px;
      font-size: 20px;
    }
    .toast span {
      display: block;
      font-size: 12px;
      color: #d1e0d5;
      margin-top: 4px;
    }
    [hidden] {
      display: none !important;
    }
    @media (prefers-reduced-motion: no-preference) {
      .card {
        animation: enter 0.18s ease-out;
      }
      @keyframes enter {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
    }

  `;
