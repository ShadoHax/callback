using System;
using System.Collections.Generic;

// Pure logic shared by the passthrough bridge and its native test harness.
public sealed class CallbackQuestAlertGate
{
    private readonly HashSet<string> seen = new HashSet<string>();
    private bool enabled;

    public void Start() { seen.Clear(); enabled = true; }
    public void Stop() { enabled = false; }

    public bool ShouldAlert(string status, string person, string item, string relation)
    {
        if (!enabled || status != "matched" || string.IsNullOrWhiteSpace(person) || string.IsNullOrWhiteSpace(item)) return false;
        return seen.Add(person + "\u001f" + item + "\u001f" + relation);
    }
}

public static class CallbackQuestFramePolicy
{
    public static void Size(int width, int height, int maximumEdge, out int outputWidth, out int outputHeight)
    {
        if (width <= 0 || height <= 0 || maximumEdge <= 0) throw new ArgumentOutOfRangeException("Frame dimensions must be positive.");
        var scale = Math.Min(1d, (double)maximumEdge / Math.Max(width, height));
        outputWidth = Math.Max(1, (int)Math.Round(width * scale));
        outputHeight = Math.Max(1, (int)Math.Round(height * scale));
    }
}
