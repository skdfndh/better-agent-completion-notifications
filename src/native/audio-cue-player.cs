using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace CodexTaskReminder
{
    public static class NativeAudioCuePlayer
    {
        private const int SampleRate = 44100;

        [DllImport("winmm.dll", SetLastError = true)]
        private static extern bool PlaySound(byte[] sound, IntPtr module, int flags);

        public static void Play(string cue)
        {
            if (String.IsNullOrWhiteSpace(cue))
            {
                return;
            }

            Task.Factory.StartNew(delegate
            {
                try
                {
                    PlaySound(BuildWave(cue), IntPtr.Zero, 0x0004);
                }
                catch
                {
                    // 音效失败不能影响桌面提醒窗口。
                }
            });
        }

        private static byte[] BuildWave(string cue)
        {
            double duration = GetDuration(cue);
            double[] samples = new double[(int)(duration * SampleRate)];

            if (cue == "completed")
            {
                AddTone(samples, 0, 0.28, 659.25, 659.25, 0.16, false);
                AddTone(samples, 0.08, 0.45, 987.77, 987.77, 0.16, false);
            }
            else if (cue == "attention")
            {
                AddTone(samples, 0, 0.18, 880, 1174.66, 0.18, true);
                AddTone(samples, 0.12, 0.18, 880, 1174.66, 0.18, true);
            }
            else
            {
                AddTone(samples, 0, 0.15, 240, 240, 0.20, false);
                AddTone(samples, 0.10, 0.25, 180, 180, 0.20, false);
            }

            using (MemoryStream stream = new MemoryStream())
            using (BinaryWriter writer = new BinaryWriter(stream))
            {
                int dataLength = samples.Length * sizeof(short);
                writer.Write(new[] { 'R', 'I', 'F', 'F' });
                writer.Write(36 + dataLength);
                writer.Write(new[] { 'W', 'A', 'V', 'E' });
                writer.Write(new[] { 'f', 'm', 't', ' ' });
                writer.Write(16);
                writer.Write((short)1);
                writer.Write((short)1);
                writer.Write(SampleRate);
                writer.Write(SampleRate * sizeof(short));
                writer.Write((short)sizeof(short));
                writer.Write((short)16);
                writer.Write(new[] { 'd', 'a', 't', 'a' });
                writer.Write(dataLength);

                foreach (double sample in samples)
                {
                    double bounded = Math.Max(-1, Math.Min(1, sample));
                    writer.Write((short)Math.Round(bounded * short.MaxValue));
                }

                return stream.ToArray();
            }
        }

        private static double GetDuration(string cue)
        {
            if (cue == "completed") return 0.53;
            if (cue == "attention") return 0.30;
            return 0.35;
        }

        private static void AddTone(double[] samples, double start, double duration, double startFrequency, double endFrequency, double peak, bool triangle)
        {
            int startIndex = (int)(start * SampleRate);
            int endIndex = Math.Min(samples.Length, startIndex + (int)(duration * SampleRate));
            double phase = 0;
            const double attackDuration = 0.015;

            for (int index = startIndex; index < endIndex; index++)
            {
                double time = (index - startIndex) / (double)SampleRate;
                double progress = time / duration;
                double frequency = startFrequency * Math.Pow(endFrequency / startFrequency, progress);
                phase += 2 * Math.PI * frequency / SampleRate;

                double envelope = time < attackDuration
                    ? peak * time / attackDuration
                    : peak * Math.Pow(0.0001 / peak, (time - attackDuration) / (duration - attackDuration));
                double waveform = triangle
                    ? 2 / Math.PI * Math.Asin(Math.Sin(phase))
                    : Math.Sin(phase);

                samples[index] += waveform * envelope;
            }
        }
    }
}
