# HTML inicial, JavaScript y noindex: ensayo local original

Ejemplo MIT independiente, sin dependencias. Node 22.23.3 y npm 10.9.9. Necesita Google Chrome; el ensayo registrado usa Chrome 154.0.8037.98 en macOS ARM64. `CHROME_BIN` permite indicar su binario.

```sh
npm test
```

No requiere instalar paquetes. El runner crea un servidor HTTP únicamente en 127.0.0.1, con puerto efímero, y seis rutas ficticias:

| Ruta | Qué compara |
| --- | --- |
| `/static` | Texto presente en el HTML inicial |
| `/javascript` | Mismo texto añadido por JavaScript, ausente del HTML inicial |
| `/meta-noindex` | Texto visible y meta robots noindex |
| `/header-noindex` | Texto visible y X-Robots-Tag noindex |
| `/remove-noindex` | Noindex inicial que JavaScript elimina en Chrome |
| `/missing` | Página legible con respuesta HTTP 404 real |

Verifica respuestas HTTP reales (estado, cabecera y HTML), renderiza cada ruta en Chrome real a 390 y 1280 píxeles y guarda DOM/captura. Los negativos comprueban ausencia del texto inicial en las rutas JS, presencia de las exclusiones donde corresponde y HTTP404 en la ruta ausente. El texto generado en el navegador no convierte automáticamente una página en indexada. Eliminar un noindex inicial en Chrome tampoco prueba que Google procese ese JavaScript.

Perfiles Chrome exclusivos y evidencia se crean en directorios privados `/tmp/hostbrid-indexability-*`. Un Chrome headless propio usa CDP sólo en loopback; verifica también viewport real, fuentes listas y ausencia de overflow. Se solicita `Browser.close`, se espera su salida y sólo después se borra su perfil. Si no sale, se termina únicamente ese proceso propio y se registra la señal. El servidor propio se cierra en `finally`; una petición posterior debe fallar. Capturas/DOM/logs quedan en la evidencia privada indicada al terminar. Una interrupción forzada del proceso no ejecuta finally.

El servidor manual opcional arranca con `npm start`, imprime la dirección local y cierra con Ctrl-C. No carga recursos externos, secretos, cuentas ni eventos analíticos. Los fuentes son originales; no incluyen un export de Lovable ni código de Google. No prueba Googlebot, Search Console, indexación, ranking, HTTPS o un servicio nativo Hostbrid.

Contexto primario, explicado sin copiar su código: [Google sobre noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing) y [Google sobre SEO con JavaScript](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).
