// ─────────────────────────────────────────────────────────────────────────────
// MODIFICATIONS À FAIRE DANS bot.service.ts
// ─────────────────────────────────────────────────────────────────────────────

// 1. Ajouter l'import en haut du fichier:
import { PositionManagerService } from "./position-manager.service";

// 2. Ajouter dans le constructeur:
//    private readonly positionManager: PositionManagerService,

// 3. Dans openFromSignal(), après le bloc "Real order" qui appelle this.bitget.placeOrder(...)
//    ajouter:

if (!session.simulation && session.user?.bitgetApiKey) {
  try {
    await this.bitget.placeOrder({
      apiKey: session.user.bitgetApiKey,
      apiSecret: session.user.bitgetApiSecret,
      passphrase: session.user.bitgetPassphrase,
      symbol: session.symbol,
      side,
      qty,
      leverage: lev,
      sl: sig.sl,
      // ← PLUS de tp/tpTargets ici — les TP sont gérés par PositionManagerService
      // On place uniquement le SL global sur Bitget comme filet de sécurité
    });

    // Enregistrer la position pour le suivi en temps réel des TP
    this.positionManager.registerPosition(session.symbol);

    this.log.log(`REAL ORDER: ${side} ${qty.toFixed(6)} ${session.symbol}`);
  } catch (e: any) {
    this.log.error("Order failed: " + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSUMÉ DES CHANGEMENTS:
//
// AVANT: le bot plaçait TP1/TP2/TP3 comme ordres TPSL sur Bitget
//        → Bitget exécutait le 1er TP et annulait les autres
//
// APRÈS: le bot place UNIQUEMENT le SL sur Bitget (filet de sécurité)
//        Les TP1/TP2/TP3 sont gérés par PositionManagerService via mark price WS
//        → Quand le mark price touche TP1: ordre de fermeture partielle (qty TP1)
//        → SL déplacé au break-even
//        → Quand mark price touche TP2: fermeture partielle (qty TP2)
//        → Quand mark price touche TP3: fermeture partielle (qty TP3) → position closed
// ─────────────────────────────────────────────────────────────────────────────
