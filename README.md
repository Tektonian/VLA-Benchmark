<div align="center">

# VLA Benchmark

**Open VLA benchmark data for robotics researchers and builders.**

[Live Leaderboard](https://tektonian.com/vla-benchmark) · [Submit a Score](../../issues/new/choose)

</div>

This repository powers the [Tektonian VLA Leaderboard](https://tektonian.com/vla-benchmark), a public index of vision-language-action models, benchmark scores, source papers, and evaluation notes.

## Data

Add one JSON file per model score under `records/<year>/`.

```txt
records/2025/0124-openvla-oft.json
```

Use the same shape as the leaderboard:

```json
{
  "model": "OpenVLA-OFT",
  "paperTitle": "Fine-Tuning Vision-Language-Action Models: Optimizing Speed and Success",
  "paperUrl": "https://arxiv.org/abs/2502.19645",
  "arxivId": "2502.19645",
  "publishedAt": "2025-02-27",
  "organization": "Stanford University",
  "flag": "🇺🇸",
  "benchmarks": [
    {
      "label": "LIBERO",
      "query": "LIBERO",
      "overall": 97.1,
      "detail": "Table 1: spatial 97.6, object 98.4, goal 97.9, long 94.5."
    }
  ]
}
```

After editing records, rebuild the generated chunks in `dist/`.

## Contributing Scores

If a VLA benchmark score is missing or wrong, open an issue with:

- model name
- benchmark name
- score
- source paper or official benchmark URL
- table, page, appendix, or row where the score appears

For direct data edits:

```sh
npm run validate
npm run build
```

Commit both the updated `records/` file and the regenerated `dist/` files.

Thank you for your contribute!

~~Planning to use github action for dist directory generation, but I don't know when it will be 🤨~~
