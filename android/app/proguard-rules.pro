# 首版不开启混淆（isMinifyEnabled=false），这里先留空占位。
# 将来开启混淆时，注意保留：
#   - Gson 反射用到的数据类（或改用 @SerializedName + 显式 keep 规则）
#   - kotlinx.serialization 生成的 $$serializer（若改用该库）
-keepattributes Signature
-keepattributes *Annotation*
