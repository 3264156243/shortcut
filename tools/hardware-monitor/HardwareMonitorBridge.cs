using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Management;
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

    public static void Main()
    {
        Console.OutputEncoding = new UTF8Encoding(false);
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
                Console.WriteLine(serializer.Serialize(snapshot));
                Console.Out.Flush();
                Thread.Sleep(1000);
            }
        }
        catch (Exception error)
        {
            Console.WriteLine(serializer.Serialize(new { error = error.Message }));
        }
        finally
        {
            computer.Close();
        }
    }
}
