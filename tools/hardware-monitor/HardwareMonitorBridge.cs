using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;

internal sealed class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) { computer.Traverse(this); }
    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (IHardware subHardware in hardware.SubHardware) subHardware.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}

internal sealed class Metric
{
    public double? temperature { get; set; }
    public double? usage { get; set; }
    public string name { get; set; }
}

internal sealed class BatteryMetric
{
    public double? level { get; set; }
    public string status { get; set; }
    public double? voltage { get; set; }
    public double? health { get; set; }
}

internal sealed class Snapshot
{
    public long timestamp { get; set; }
    public Metric cpu { get; set; }
    public Metric gpu { get; set; }
    public Metric memory { get; set; }
    public BatteryMetric battery { get; set; }
}

internal static class Program
{
    // 提权模式（--pipe）下用命名管道代替 stdout，并把控制台窗口摘掉。
    // 背景：ShellExecuteEx(Verb=runas) 无法重定向 stdout，而本程序被计划任务以
    // Highest 权限拉起时必须能把数据送回普通权限的主进程 → 只能走命名管道
    // （UIPI 只拦窗口消息，不拦命名管道）。
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    /// <summary>把 `\\.\pipe\name` 或裸名字统一成 NamedPipeClientStream 需要的名字。</summary>
    private static string PipeLeafName(string raw)
    {
        int mark = raw.LastIndexOf("\\pipe\\", StringComparison.OrdinalIgnoreCase);
        return mark >= 0 ? raw.Substring(mark + 6) : raw;
    }

    /// <summary>带重试地连主进程（主进程先建 server 再拉起本进程，正常第一次就连上）。</summary>
    private static NamedPipeClientStream ConnectPipe(string name, int timeoutMs)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            NamedPipeClientStream client = new NamedPipeClientStream(".", name, PipeDirection.Out);
            try
            {
                client.Connect(500);
                return client;
            }
            catch
            {
                client.Dispose();
                Thread.Sleep(200);
            }
        }
        return null;
    }

    /// <summary>写一行。返回 false = 通道已断（主进程没了）→ 侧车自退，等价于原来的 Job Object 回收。</summary>
    private static bool Emit(TextWriter sink, string line)
    {
        try
        {
            sink.Write(line);
            sink.Write('\n');
            sink.Flush();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static double? MaxSensor(IHardware hardware, SensorType type, params string[] preferred)
    {
        IEnumerable<ISensor> sensors = hardware.Sensors.Where(sensor => sensor.SensorType == type && sensor.Value.HasValue);
        foreach (string name in preferred)
        {
            ISensor match = sensors.FirstOrDefault(sensor => sensor.Name.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0);
            if (match != null) return Math.Round(match.Value.Value, 1);
        }
        List<float> values = sensors.Select(sensor => sensor.Value.Value).ToList();
        return values.Count == 0 ? (double?)null : Math.Round(values.Max(), 1);
    }

    private static IEnumerable<IHardware> Flatten(IEnumerable<IHardware> hardware)
    {
        foreach (IHardware item in hardware)
        {
            yield return item;
            foreach (IHardware sub in Flatten(item.SubHardware)) yield return sub;
        }
    }

    private static Metric ReadMetric(IEnumerable<IHardware> all, Func<string, bool> matcher, bool usage)
    {
        List<IHardware> matches = all.Where(item => matcher(item.HardwareType.ToString())).ToList();
        IHardware primary = matches.FirstOrDefault();
        if (primary == null) return new Metric { name = null, temperature = null, usage = null };
        double? temperature = matches.Select(item => MaxSensor(item, SensorType.Temperature, "Package", "Core", "GPU Core", "System")).FirstOrDefault(value => value.HasValue);
        double? load = usage ? matches.Select(item => MaxSensor(item, SensorType.Load, "Total", "GPU Core", "Core")).FirstOrDefault(value => value.HasValue) : null;
        return new Metric { name = primary.Name, temperature = temperature, usage = load };
    }


    private static Metric ReadMemory(IEnumerable<IHardware> all)
    {
        List<IHardware> hardware = all.ToList();
        List<IHardware> memory = hardware.Where(item =>
            item.HardwareType.ToString().IndexOf("Memory", StringComparison.OrdinalIgnoreCase) >= 0).ToList();
        double? usage = memory.Select(item => MaxSensor(item, SensorType.Load, "Memory")).FirstOrDefault(value => value.HasValue);

        IEnumerable<ISensor> temperatureSensors = hardware
            .Where(item => item.HardwareType.ToString().IndexOf("Gpu", StringComparison.OrdinalIgnoreCase) < 0)
            .SelectMany(item => item.Sensors)
            .Where(sensor => sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
            .Where(sensor =>
                sensor.Name.IndexOf("DIMM", StringComparison.OrdinalIgnoreCase) >= 0 ||
                sensor.Name.IndexOf("DRAM", StringComparison.OrdinalIgnoreCase) >= 0 ||
                sensor.Name.IndexOf("Memory", StringComparison.OrdinalIgnoreCase) >= 0);
        double? temperature = temperatureSensors.Any()
            ? Math.Round(temperatureSensors.Max(sensor => sensor.Value.Value), 1)
            : (double?)null;

        return new Metric { name = "系统内存", temperature = temperature, usage = usage };
    }

    private static object WmiValue(ManagementBaseObject item, string property)
    {
        try { return item[property]; } catch { return null; }
    }

    private static double? Number(object value, double divisor)
    {
        if (value == null) return null;
        double parsed;
        return double.TryParse(Convert.ToString(value), out parsed) ? Math.Round(parsed / divisor, 1) : (double?)null;
    }

    private static BatteryMetric ReadBattery(IEnumerable<IHardware> all)
    {
        BatteryMetric result = new BatteryMetric { status = "未获取到数据" };
        IHardware batteryHardware = all.FirstOrDefault(item => item.HardwareType.ToString().IndexOf("Battery", StringComparison.OrdinalIgnoreCase) >= 0);
        if (batteryHardware != null)
        {
            result.level = MaxSensor(batteryHardware, SensorType.Level, "Charge", "Level");
            result.voltage = MaxSensor(batteryHardware, SensorType.Voltage) ;
        }

        try
        {
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\CIMV2", "SELECT EstimatedChargeRemaining,BatteryStatus,DesignVoltage FROM Win32_Battery"))
            {
                ManagementObject battery = searcher.Get().Cast<ManagementObject>().FirstOrDefault();
                if (battery == null) return result;
                if (!result.level.HasValue) result.level = Number(WmiValue(battery, "EstimatedChargeRemaining"), 1);
                if (!result.voltage.HasValue) result.voltage = Number(WmiValue(battery, "DesignVoltage"), 1000);
                int status;
                int.TryParse(Convert.ToString(WmiValue(battery, "BatteryStatus")), out status);
                result.status = status == 2 || status == 6 || status == 7 || status == 8 || status == 9 ? "充电中"
                    : status == 1 || status == 4 || status == 5 ? "放电中"
                    : status == 3 ? "已充满" : "已连接";
            }

            double? full = null;
            double? designed = null;
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\WMI", "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity"))
            {
                ManagementBaseObject item = searcher.Get().Cast<ManagementBaseObject>().FirstOrDefault();
                if (item != null) full = Number(WmiValue(item, "FullChargedCapacity"), 1);
            }
            using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\WMI", "SELECT DesignedCapacity FROM BatteryStaticData"))
            {
                ManagementBaseObject item = searcher.Get().Cast<ManagementBaseObject>().FirstOrDefault();
                if (item != null) designed = Number(WmiValue(item, "DesignedCapacity"), 1);
            }
            if (full.HasValue && designed.HasValue && designed.Value > 0)
                result.health = Math.Round(Math.Min(100, full.Value / designed.Value * 100), 1);
        }
        catch { }
        return result;
    }

    public static void Main(string[] args)
    {
        // 解析 --pipe <管道名>：有 → 管道模式（提权态用），无 → stdout 模式（主进程直接 spawn，兼容原行为）
        string pipePath = null;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--pipe", StringComparison.OrdinalIgnoreCase))
            {
                pipePath = args[i + 1];
            }
        }

        TextWriter sink;
        IDisposable owned = null;
        if (pipePath != null)
        {
            try { FreeConsole(); } catch { }   // 计划任务拉起时不留黑窗
            NamedPipeClientStream client = ConnectPipe(PipeLeafName(pipePath), 5000);
            if (client == null)
            {
                return;   // 主进程没在等这个管道 → 直接退出（主进程会走 stdout 兜底）
            }
            StreamWriter writer = new StreamWriter(client, new UTF8Encoding(false), 1024);
            writer.AutoFlush = false;
            sink = writer;
            owned = writer;
        }
        else
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            sink = Console.Out;
        }

        Computer computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMotherboardEnabled = true,
            IsBatteryEnabled = true,
            IsMemoryEnabled = true,
            IsStorageEnabled = false,
            IsNetworkEnabled = false,
            IsControllerEnabled = false,
            IsPsuEnabled = false
        };

        JavaScriptSerializer serializer = new JavaScriptSerializer();
        UpdateVisitor visitor = new UpdateVisitor();
        try
        {
            computer.Open();
            while (true)
            {
                computer.Accept(visitor);
                List<IHardware> all = Flatten(computer.Hardware).ToList();
                Snapshot snapshot = new Snapshot
                {
                    timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    cpu = ReadMetric(all, type => type.IndexOf("Cpu", StringComparison.OrdinalIgnoreCase) >= 0, true),
                    gpu = ReadMetric(all, type => type.IndexOf("Gpu", StringComparison.OrdinalIgnoreCase) >= 0, true),
                    memory = ReadMemory(all),
                    battery = ReadBattery(all)
                };
                if (!Emit(sink, serializer.Serialize(snapshot)))
                {
                    break;   // 管道断开 = 主进程已退出
                }
                Thread.Sleep(1000);
            }
        }
        catch (Exception error)
        {
            Emit(sink, serializer.Serialize(new { error = error.Message }));
        }
        finally
        {
            computer.Close();
            if (owned != null)
            {
                try { owned.Dispose(); } catch { }
            }
        }
    }
}
