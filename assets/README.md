# Ресурсы kasholkaTTS

- `loading.png`: побайтовая копия предоставленного пользователем
  `ktts_loading_osn.png` (616 × 393). Используется как фон экрана запуска.
  Версия и этап рисуются отдельными элементами AppKit; индикатор удалён в 1.4.6.
  `ktts_loading_example.png` использован только как пример расположения текста.
- `about.mp4`: копия предоставленного пользователем файла
  `Man walking Green Screen background [KgU6af86McY].mp4`, без перекодирования.
  Зацикливается без звука в окне About. Исходник на рабочем столе не изменён.
- `icon-source.png`: чёрный силуэт на зелёном фоне, созданный встроенным image_gen
  по второму изображению пользователя. CLI/API не использовались.
- `kasholkaTTS.png`: итоговый PNG 1024 × 1024 после разрешённой пользователем
  программной очистки. Скруглённые углы сохранены; прозрачность только снаружи.
- `kasholkaTTS.icns`: итоговая иконка для macOS, размеры 16–1024 пикселя.
- `../beta/assets/kasholkaTTS.png` и `.icns`: отдельная иконка Beta с фоном `#0040ff`.
  Силуэт и скругления строятся тем же скриптом, прозрачность совпадает с основной иконкой.

Первые варианты image_gen с прозрачностью дали пятна внутри зелёного поля
и были отклонены пользователем. Они не включены в проект или установщик.
На просьбу сделать иконку программно пользователь ответил: «Да, сделай программно».
Скрипт `scripts/build_icon.py` выделяет тёмный силуэт из чистого непрозрачного
варианта, делает зелёный фон одноцветным `#00e600`, задаёт геометрическое
скругление и формирует PNG/ICNS. Внутри иконки прозрачных дыр нет.

Последний промпт встроенного генератора, результат которого используется как исходник:

> Fix this icon: preserve the central black walking man's silhouette and full body pose,
> size and position. Replace ALL remaining pixels, including all corners and any noise,
> transparent holes, texture and shading, with one perfectly uniform solid vivid green
> #00e600. Full opaque square canvas, no rounded tile, no transparency, no shadows,
> no gradients, no speckle, no extra silhouettes. Only two colors: solid black silhouette
> on an absolutely flat opaque vivid green square background. 1024x1024 PNG.

Указание про квадрат относится только к промежуточному исходнику. По последующей
правке пользователя скругления возвращены программно в итоговом файле.
