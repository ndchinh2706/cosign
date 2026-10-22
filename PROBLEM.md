# RMIT HACKATHON 2026 — Multilingual Prompt-Attack Classification

Nguồn: https://www.kaggle.com/competitions/rmit-hackathon-2026/overview (lấy ngày 2026-10-22, lúc đó còn ~8 giờ là đóng)

## Bài toán

Phân loại prompt (tiếng Bồ Đào Nha, Pháp, Ý, Anh; phần lớn không phải tiếng Anh) vào 3 lớp:

| label | ý nghĩa |
|---|---|
| BENIGN | yêu cầu bình thường, an toàn |
| JAILBREAK | cố thuyết phục model bỏ qua luật an toàn |
| PROMPT_INJECTION | cố chiếm quyền chỉ dẫn (instructions) của model |

## Dữ liệu

- `train.csv`: 14,000 dòng, cột `id, text, language, label`
- `test.csv`: 6,000 dòng
- Mất cân bằng lớp: BENIGN 62%, JAILBREAK 31%, PROMPT_INJECTION 7%

## Model được phép (bắt buộc dùng một trong số này, không backbone pretrained nào khác)

| Model | Loại | Gợi ý |
|---|---|---|
| distilbert/distilbert-base-multilingual-cased | encoder | baseline nhanh nhất |
| jhu-clsp/mmBERT-small | encoder | nhanh, đa ngôn ngữ |
| jhu-clsp/mmBERT-base | encoder | đa ngôn ngữ mạnh |
| FacebookAI/xlm-roberta-base | encoder | đa ngôn ngữ mạnh |
| FacebookAI/xlm-roberta-large | encoder | encoder tốt nhất, cần nhiều VRAM |
| google/rembert | encoder | batch size 8 |
| protectai/deberta-v3-base-prompt-injection-v2 | encoder (safety-tuned) | đã biết prompt injection |
| patronus-studio/wolf-defender-prompt-injection | encoder (safety-tuned) | đã biết prompt injection |
| ibm-granite/granite-3.3-2b-instruct | LLM | LoRA |
| mistralai/Mistral-7B-Instruct-v0.3 | LLM | LoRA |

Các model có sẵn dưới dạng Kaggle Models (owner `aisuko`), vd `https://www.kaggle.com/models/aisuko/xlm-roberta-large/Transformers/default`.

Phải ghi rõ model đã chọn ở đầu notebook.

## Gợi ý của BTC

- Encoder: `AutoModelForSequenceClassification`, `num_labels=3`
- LLM: LoRA / QLoRA, hoặc classification head ràng buộc
- Xử lý mất cân bằng: class weights, focal loss, resampling
- Tận dụng cột `language` — hiệu năng không đều giữa các ngôn ngữ
- Ưu tiên generalize, đừng overfit leaderboard

## Đánh giá

- **Macro-F1** trên 3 lớp (PROMPT_INJECTION nặng ngang BENIGN)
- Đoán toàn BENIGN ≈ 0.26; hoàn hảo = 1.0
- **Chỉ 6 lần submit**
- Nộp hợp lệ lần đầu là đủ điểm Challenge 1, sau đó tối ưu leaderboard

## Format submission

CSV đúng 6,000 dòng + header:

```
id,label
t000006,BENIGN
t000007,PROMPT_INJECTION
t000008,JAILBREAK
```

## Quy định đặt tên notebook

`<university>_<campus>_<team>_C1`, `<campus>` ∈ {SGS, HNI, MEL, MYS}
- vd: `RMIT_SGS_a_C1`, `RMIT_HNI_beautiful_C1`
- `<university>`, `<campus>` chỉ chữ cái; `<team>` gồm chữ/số/`_`/`-`

## Khác

- Challenge 1 chấm qua Kaggle leaderboard; các challenge khác chạy trên RMIT RACE Cloud
- Website: https://rmit-hackathon.com/
