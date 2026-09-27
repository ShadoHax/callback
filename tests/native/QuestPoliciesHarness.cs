using System;

public static class QuestPoliciesHarness
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    public static void Main()
    {
        var gate = new CallbackQuestAlertGate();
        Check(!gate.ShouldAlert("matched", "Maya", "mug", "gift"), "disabled gate alerted");
        gate.Start();
        Check(gate.ShouldAlert("matched", "Maya", "mug", "gift"), "first match hidden");
        Check(!gate.ShouldAlert("matched", "Maya", "mug", "gift"), "duplicate alerted");
        Check(gate.ShouldAlert("matched", "Ari", "book", "wish"), "different match hidden");
        Check(!gate.ShouldAlert("matched", "Maya", "mug", "gift"), "A-B-A duplicate alerted");
        Check(!gate.ShouldAlert("no_match", "Maya", "lamp", "gift"), "no-match alerted");
        gate.Stop();
        Check(!gate.ShouldAlert("matched", "Maya", "lamp", "gift"), "stopped gate alerted");
        gate.Start();
        Check(gate.ShouldAlert("matched", "Maya", "mug", "gift"), "new session did not reset");

        CallbackQuestFramePolicy.Size(4096, 2048, 1024, out var width, out var height);
        Check(width == 1024 && height == 512, "landscape downscale incorrect");
        CallbackQuestFramePolicy.Size(600, 800, 1024, out width, out height);
        Check(width == 600 && height == 800, "small frame changed");
        CallbackQuestFramePolicy.Size(1000, 2000, 1024, out width, out height);
        Check(width == 512 && height == 1024, "portrait downscale incorrect");
        Console.WriteLine("Quest passthrough policy harness passed.");
    }
}
