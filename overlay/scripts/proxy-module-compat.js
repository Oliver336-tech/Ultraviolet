// Scramjet 1.1.0 marks static and imported ES modules with ?type=module,
// but does not mark a script created through DOM APIs. Keep those entrypoints
// identical to their imports so cyclic module graphs share a single instance.
(function () {
  var originalFactory = globalThis.$scramjetLoadClient;
  if (typeof originalFactory !== 'function') return;
  globalThis.$scramjetLoadClient = function () {
    var api = originalFactory();
    return Object.assign({}, api, {
      loadAndHook: function (config) {
        var result = api.loadAndHook(config);
        if (typeof document === 'undefined' || !globalThis.HTMLScriptElement) return result;
        var client = globalThis[Symbol.for('scramjet client global')];
        if (!client || client.__moduleIdentityFixed) return result;
        client.__moduleIdentityFixed = true;
        var getAttribute = client.natives.store['Element.prototype.getAttribute'];
        var setAttribute = client.natives.store['Element.prototype.setAttribute'];
        var baseDescriptor = client.descriptors && client.descriptors.store['Node.prototype.baseURI'];

        function normalizeScript(node) {
          if (!(node instanceof HTMLScriptElement)) return;
          if ((getAttribute.call(node, 'type') || '').toLowerCase() !== 'module') return;
          var source = getAttribute.call(node, 'src');
          if (!source) return;
          var url;
          // Resolve relative rewritten URLs against the browser's real base;
          // the engine's public baseURI getter exposes the upstream page base.
          try { url = new URL(source, baseDescriptor && baseDescriptor.get ? baseDescriptor.get.call(node) : globalThis.location.href); } catch (_) { return; }
          if (!url.pathname.startsWith(config.prefix)) return;
          if (url.searchParams.get('type') === 'module') return;
          url.searchParams.set('type', 'module');
          // Bypass the URL rewriter here; source has already been rewritten.
          // Retain scramjet-attr-src so the page still sees its original URL.
          setAttribute.call(node, 'src', url.href);
        }

        function normalizeNode(node) {
          if (!node || typeof node !== 'object') return;
          normalizeScript(node);
          if (typeof node.querySelectorAll === 'function') {
            for (var script of node.querySelectorAll('script[type="module"][src]')) normalizeScript(script);
          }
        }

        for (var name of ['src', 'type']) {
          var descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, name);
          if (!descriptor || !descriptor.set || !descriptor.configurable) continue;
          (function (name, descriptor) {
            Object.defineProperty(HTMLScriptElement.prototype, name, Object.assign({}, descriptor, {
              set: function (value) { descriptor.set.call(this, value); normalizeScript(this); },
            }));
          })(name, descriptor);
        }
        var originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
          var result = originalSetAttribute.call(this, name, value);
          if (/^(src|type)$/i.test(name)) normalizeScript(this);
          return result;
        };
        for (var pair of [
          [Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']],
          [Element.prototype, ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren']],
          [DocumentFragment.prototype, ['append', 'prepend', 'replaceChildren']],
        ]) {
          for (var method of pair[1]) {
            var original = pair[0][method];
            if (typeof original !== 'function') continue;
            (function (prototype, method, original) {
              prototype[method] = function () {
                for (var node of arguments) normalizeNode(node);
                return Reflect.apply(original, this, arguments);
              };
            })(pair[0], method, original);
          }
        }
        return result;
      },
    });
  };
})();
