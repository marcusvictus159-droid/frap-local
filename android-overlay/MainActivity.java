package com.softechmx.frapcrm;

import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Pantalla completa (Android 15+) sin que la barra de estado, la barra de
 * navegación ni el teclado tapen la app. Calcula sus alturas en píxeles CSS y
 * se las entrega a la página:
 *   --status-bar-height   --nav-bar-height   --keyboard-height
 * (ver app-config.js: window.__setInsets y window.AndroidInsets).
 */
public class MainActivity extends BridgeActivity {

    private volatile int arriba = 0, abajo = 0, teclado = 0;

    private class InsetsJs {
        @JavascriptInterface public int top() { return arriba; }
        @JavascriptInterface public int bottom() { return abajo; }
        @JavascriptInterface public int keyboard() { return teclado; }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final WebView web = getBridge().getWebView();
        web.addJavascriptInterface(new InsetsJs(), "AndroidInsets");

        final View raiz = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(raiz, (v, insets) -> {
            float d = getResources().getDisplayMetrics().density;
            Insets barras = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            arriba = Math.round(barras.top / d);
            abajo = Math.round(barras.bottom / d);
            teclado = ime.bottom > barras.bottom ? Math.round((ime.bottom - barras.bottom) / d) : 0;
            empujar(web);
            return insets;
        });
        ViewCompat.requestApplyInsets(raiz);
        // La página puede terminar de cargar después: reenviamos unos instantes.
        web.postDelayed(() -> empujar(web), 400);
        web.postDelayed(() -> empujar(web), 1500);
    }

    @Override
    public void onResume() {
        super.onResume();
        empujar(getBridge().getWebView());
    }

    private void empujar(final WebView web) {
        final String js = "window.__setInsets&&window.__setInsets(" + arriba + "," + abajo + "," + teclado + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
