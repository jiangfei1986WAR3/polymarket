from __future__ import annotations


def brier_score(probs, labels):
    if len(probs) != len(labels):
        raise ValueError("length mismatch")
    if not probs:
        raise ValueError("empty")

    s = 0.0
    for p, y in zip(probs, labels):
        s += (p - float(y)) ** 2
    return s / len(probs)


def accuracy_from_probs(probs, labels, threshold=0.5):
    if len(probs) != len(labels):
        raise ValueError("length mismatch")
    if not probs:
        raise ValueError("empty")

    correct = 0
    for p, y in zip(probs, labels):
        pred = 1 if p > threshold else 0
        correct += 1 if pred == y else 0
    return correct / len(probs)
