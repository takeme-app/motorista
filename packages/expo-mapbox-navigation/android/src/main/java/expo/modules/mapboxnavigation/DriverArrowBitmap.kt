package expo.modules.mapboxnavigation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.DisplayMetrics

/**
 * Pequeno helper utilitário responsável por gerar o pictograma de seta
 * usado como `bearingImage` do [com.mapbox.maps.plugin.LocationPuck2D].
 *
 * O bitmap aponta para "cima" (rotação 0° = norte) — o `LocationComponent`
 * o rotaciona conforme `puckBearing` (COURSE = direção do movimento).
 *
 * IMPORTANTE: nada de `setShadowLayer` aqui. Quando o componente roda a
 * imagem, qualquer sombra "fixa" do bitmap rodaria junto, criando um
 * efeito visual estranho (sombra para o lado em vez de baixo). O
 * destaque sobre o mapa vem da borda branca grossa.
 */
internal object DriverArrowBitmap {
  /** Tamanho lógico do ícone em dp. */
  private const val SIZE_DP = 56

  fun create(metrics: DisplayMetrics): Bitmap {
    val sizePx = (SIZE_DP * metrics.density).toInt().coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)

    val cx = sizePx / 2f
    val cy = sizePx / 2f
    val halfWidth = sizePx * 0.34f
    val height = sizePx * 0.44f

    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.BLACK
      style = Paint.Style.FILL
    }

    val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      style = Paint.Style.STROKE
      strokeWidth = sizePx * 0.09f
      strokeJoin = Paint.Join.ROUND
      strokeCap = Paint.Cap.ROUND
    }

    // Triângulo isósceles com base levemente côncava — leitura imediata como "seta".
    val path = Path().apply {
      moveTo(cx, cy - height)
      lineTo(cx + halfWidth, cy + height * 0.62f)
      lineTo(cx, cy + height * 0.26f)
      lineTo(cx - halfWidth, cy + height * 0.62f)
      close()
    }

    canvas.drawPath(path, fill)
    canvas.drawPath(path, border)

    return bmp
  }
}
