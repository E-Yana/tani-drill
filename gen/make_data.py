"""たんいドリルの問題バンク（data.js）を生成するスクリプト。

使い方: python3 gen/make_data.py data.js
標準ライブラリのみ。number 問題は Decimal で検算し、assert が外れたら失敗終了する。
"""

from __future__ import annotations

import ast
import json
import re
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

# ---------------------------------------------------------------------------
# 定数（段階・件数・単位換算表）
# ---------------------------------------------------------------------------

# 段階の定義: stage -> (名前, 件数)
STAGES: dict[int, tuple[str, int]] = {
    1: ("3年のふくしゅう：長さ", 12),
    2: ("3年のふくしゅう：重さ・かさ・時間", 29),
    3: ("4年：小数と単位", 13),
    4: ("4年：面積（cm²・m²）", 11),
    5: ("4年：大きな面積（a・ha・km²）", 11),
    6: ("4年：単位えらび", 14),
    7: ("4年：まとめの文章題", 10),
}

# 段階 -> unit 別の期待件数
EXPECTED_UNITS_BY_STAGE: dict[int, dict[str, int]] = {
    1: {"長さ": 12},
    2: {"時間": 10, "重さ": 10, "かさ": 9},
    3: {"長さ": 4, "重さ": 4, "かさ": 5},
    4: {"面積": 11},
    5: {"面積": 11},
    6: {"単位えらび": 14},
    7: {"文章題": 10},
}

# unit 別の期待合計
EXPECTED_UNIT_TOTALS: dict[str, int] = {
    "長さ": 16,
    "重さ": 14,
    "かさ": 14,
    "時間": 10,
    "面積": 22,
    "単位えらび": 14,
    "文章題": 10,
}

TOTAL_PROBLEMS = 100
CHOICE_COUNT = 3
ID_PATTERN = re.compile(r"^t-\d{4}$")
ID_IN_JS_PATTERN = re.compile(r'id:\s*"(t-\d{4})"')

# 単位換算表: 単位 -> (次元, 次元ごとの基準単位に対する倍率)
# 基準: 長さ=mm, 重さ=g, かさ=mL, 時間=秒, 面積=cm²
UNIT_TABLE: dict[str, tuple[str, Decimal]] = {
    "mm": ("長さ", Decimal(1)),
    "cm": ("長さ", Decimal(10)),
    "m": ("長さ", Decimal(1000)),
    "km": ("長さ", Decimal(1000000)),
    "g": ("重さ", Decimal(1)),
    "kg": ("重さ", Decimal(1000)),
    "t": ("重さ", Decimal(1000000)),
    "mL": ("かさ", Decimal(1)),
    "dL": ("かさ", Decimal(100)),
    "L": ("かさ", Decimal(1000)),
    "秒": ("時間", Decimal(1)),
    "分": ("時間", Decimal(60)),
    "時間": ("時間", Decimal(3600)),
    "cm²": ("面積", Decimal(1)),
    "m²": ("面積", Decimal(10000)),
    "a": ("面積", Decimal(1000000)),
    "ha": ("面積", Decimal(100000000)),
    "km²": ("面積", Decimal(10000000000)),
}

# 「3cm4mm」のような複合表記を 数値+単位 に分解する正規表現（長い単位名を先に）
_UNIT_ALTERNATION = "|".join(sorted(map(re.escape, UNIT_TABLE), key=len, reverse=True))
TOKEN_PATTERN = re.compile(rf"(\d+(?:\.\d+)?)({_UNIT_ALTERNATION})")


# ---------------------------------------------------------------------------
# 問題の型と作成ヘルパー
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Problem:
    """1問分のデータ。calc は number 問題の検算用（data.js には出さない）。"""

    id: str
    stage: int
    unit: str
    type: str
    prompt: str
    answer: str
    explain: str
    suffix: str = ""
    choices: tuple[str, ...] = ()
    calc: tuple[str, ...] = ()


def conv(
    pid: str, stage: int, unit: str, src: str, dst: str, answer: str, explain: str
) -> Problem:
    """単位換算の問題（src を dst で表す）。"""
    return Problem(
        id=pid,
        stage=stage,
        unit=unit,
        type="number",
        prompt=f"{src} は 何{dst} ですか。",
        answer=answer,
        explain=explain,
        suffix=dst,
        calc=("conv", src, dst),
    )


def calc_q(
    pid: str,
    stage: int,
    unit: str,
    prompt: str,
    answer: str,
    suffix: str,
    expr: str,
    explain: str,
) -> Problem:
    """式（Decimal で評価）で検算する number 問題。"""
    return Problem(
        id=pid,
        stage=stage,
        unit=unit,
        type="number",
        prompt=prompt,
        answer=answer,
        explain=explain,
        suffix=suffix,
        calc=("expr", expr),
    )


def pick(
    pid: str,
    prompt: str,
    answer: str,
    choices: tuple[str, str, str],
    explain: str,
) -> Problem:
    """段階6の単位えらび（3択）。"""
    return Problem(
        id=pid,
        stage=6,
        unit="単位えらび",
        type="choice",
        prompt=prompt,
        answer=answer,
        explain=explain,
        choices=choices,
    )


# ---------------------------------------------------------------------------
# 問題の定義（id は各問題に固定で書く。並べ替えても番号を振り直さない）
# ---------------------------------------------------------------------------


def stage1() -> list[Problem]:
    """段階1: 3年のふくしゅう 長さ（12問）。"""
    u = "長さ"
    return [
        conv("t-0001", 1, u, "3cm4mm", "mm", "34", "1cm＝10mm なので 30mm＋4mm＝34mm"),
        conv("t-0002", 1, u, "5cm", "mm", "50", "1cm＝10mm なので 5×10＝50mm"),
        conv("t-0003", 1, u, "70mm", "cm", "7", "10mm＝1cm なので 70÷10＝7cm"),
        conv("t-0004", 1, u, "2m", "cm", "200", "1m＝100cm なので 2×100＝200cm"),
        conv("t-0005", 1, u, "3m50cm", "cm", "350", "300cm＋50cm＝350cm"),
        conv("t-0006", 1, u, "600cm", "m", "6", "100cm＝1m なので 600÷100＝6m"),
        conv("t-0007", 1, u, "4km", "m", "4000", "1km＝1000m なので 4×1000＝4000m"),
        conv("t-0008", 1, u, "2km500m", "m", "2500", "2000m＋500m＝2500m"),
        conv("t-0009", 1, u, "7000m", "km", "7", "1000m＝1km なので 7000÷1000＝7km"),
        conv("t-0010", 1, u, "1m", "mm", "1000", "1m＝100cm＝1000mm"),
        conv("t-0011", 1, u, "8cm2mm", "mm", "82", "80mm＋2mm＝82mm"),
        calc_q(
            "t-0012",
            1,
            u,
            "1km から 200m ひいた 道のりは 何mですか。",
            "800",
            "m",
            "1000-200",
            "1km＝1000m なので 1000m－200m＝800m",
        ),
    ]


def stage2() -> list[Problem]:
    """段階2: 3年のふくしゅう 時間・重さ・かさ（29問）。"""
    t, w, v = "時間", "重さ", "かさ"
    return [
        # 時間（10問）
        conv("t-0013", 2, t, "3分", "秒", "180", "1分＝60秒 なので 3×60＝180秒"),
        conv("t-0014", 2, t, "2分30秒", "秒", "150", "120秒＋30秒＝150秒"),
        conv("t-0015", 2, t, "120秒", "分", "2", "60秒＝1分 なので 120÷60＝2分"),
        conv("t-0016", 2, t, "2時間", "分", "120", "1時間＝60分 なので 2×60＝120分"),
        conv("t-0017", 2, t, "1時間30分", "分", "90", "60分＋30分＝90分"),
        conv("t-0018", 2, t, "180分", "時間", "3", "60分＝1時間 なので 180÷60＝3時間"),
        calc_q(
            "t-0019",
            2,
            t,
            "75分は 1時間と 何分ですか。",
            "15",
            "分",
            "75-60",
            "75分から 1時間（60分）を ひくと 15分",
        ),
        conv("t-0020", 2, t, "1分20秒", "秒", "80", "60秒＋20秒＝80秒"),
        conv("t-0021", 2, t, "300秒", "分", "5", "60秒＝1分 なので 300÷60＝5分"),
        conv("t-0022", 2, t, "4時間20分", "分", "260", "240分＋20分＝260分"),
        # 重さ（10問）
        conv("t-0023", 2, w, "3kg", "g", "3000", "1kg＝1000g なので 3×1000＝3000g"),
        conv("t-0024", 2, w, "2kg500g", "g", "2500", "2000g＋500g＝2500g"),
        conv("t-0025", 2, w, "4000g", "kg", "4", "1000g＝1kg なので 4000÷1000＝4kg"),
        conv("t-0026", 2, w, "3t", "kg", "3000", "1t＝1000kg なので 3×1000＝3000kg"),
        conv("t-0027", 2, w, "5000kg", "t", "5", "1000kg＝1t なので 5000÷1000＝5t"),
        conv("t-0028", 2, w, "1kg200g", "g", "1200", "1000g＋200g＝1200g"),
        conv("t-0029", 2, w, "6kg30g", "g", "6030", "6000g＋30g＝6030g"),
        conv("t-0030", 2, w, "1t500kg", "kg", "1500", "1000kg＋500kg＝1500kg"),
        calc_q(
            "t-0031",
            2,
            w,
            "1kg の こむぎこから 300g つかいました。のこりは 何gですか。",
            "700",
            "g",
            "1000-300",
            "1kg＝1000g なので 1000g－300g＝700g",
        ),
        conv("t-0032", 2, w, "2000g", "kg", "2", "1000g＝1kg なので 2000÷1000＝2kg"),
        # かさ（9問）
        conv("t-0033", 2, v, "3L", "dL", "30", "1L＝10dL なので 3×10＝30dL"),
        conv("t-0034", 2, v, "50dL", "L", "5", "10dL＝1L なので 50÷10＝5L"),
        conv("t-0035", 2, v, "2dL", "mL", "200", "1dL＝100mL なので 2×100＝200mL"),
        conv("t-0036", 2, v, "700mL", "dL", "7", "100mL＝1dL なので 700÷100＝7dL"),
        conv("t-0037", 2, v, "2L", "mL", "2000", "1L＝1000mL なので 2×1000＝2000mL"),
        conv("t-0038", 2, v, "4000mL", "L", "4", "1000mL＝1L なので 4000÷1000＝4L"),
        conv("t-0039", 2, v, "1L5dL", "dL", "15", "10dL＋5dL＝15dL"),
        conv("t-0040", 2, v, "3L500mL", "mL", "3500", "3000mL＋500mL＝3500mL"),
        calc_q(
            "t-0041",
            2,
            v,
            "1L の ジュースから 400mL のみました。のこりは 何mLですか。",
            "600",
            "mL",
            "1000-400",
            "1L＝1000mL なので 1000mL－400mL＝600mL",
        ),
    ]


def stage3() -> list[Problem]:
    """段階3: 4年 小数と単位（13問）。"""
    return [
        conv(
            "t-0042",
            3,
            "長さ",
            "1.25m",
            "cm",
            "125",
            "1m＝100cm なので 1.25×100＝125cm",
        ),
        conv("t-0043", 3, "長さ", "3.5cm", "mm", "35", "1cm＝10mm なので 3.5×10＝35mm"),
        conv(
            "t-0044",
            3,
            "長さ",
            "2.4km",
            "m",
            "2400",
            "1km＝1000m なので 2.4×1000＝2400m",
        ),
        conv(
            "t-0045",
            3,
            "長さ",
            "850m",
            "km",
            "0.85",
            "1000m＝1km なので 850÷1000＝0.85km",
        ),
        conv(
            "t-0046",
            3,
            "重さ",
            "350g",
            "kg",
            "0.35",
            "1000g＝1kg なので 350÷1000＝0.35kg",
        ),
        conv(
            "t-0047",
            3,
            "重さ",
            "2.4kg",
            "g",
            "2400",
            "1kg＝1000g なので 2.4×1000＝2400g",
        ),
        conv(
            "t-0048",
            3,
            "重さ",
            "1.5t",
            "kg",
            "1500",
            "1t＝1000kg なので 1.5×1000＝1500kg",
        ),
        conv(
            "t-0049",
            3,
            "重さ",
            "75g",
            "kg",
            "0.075",
            "1000g＝1kg なので 75÷1000＝0.075kg",
        ),
        conv("t-0050", 3, "かさ", "2.4L", "dL", "24", "1L＝10dL なので 2.4×10＝24dL"),
        conv(
            "t-0051",
            3,
            "かさ",
            "350mL",
            "L",
            "0.35",
            "1000mL＝1L なので 350÷1000＝0.35L",
        ),
        conv(
            "t-0052",
            3,
            "かさ",
            "0.6L",
            "mL",
            "600",
            "1L＝1000mL なので 0.6×1000＝600mL",
        ),
        conv(
            "t-0053",
            3,
            "かさ",
            "1.5L",
            "mL",
            "1500",
            "1L＝1000mL なので 1.5×1000＝1500mL",
        ),
        conv("t-0054", 3, "かさ", "8dL", "L", "0.8", "10dL＝1L なので 8÷10＝0.8L"),
    ]


def stage4() -> list[Problem]:
    """段階4: 4年 面積（cm²・m²）（11問）。"""
    u = "面積"
    return [
        calc_q(
            "t-0055",
            4,
            u,
            "たて 4cm、よこ 6cm の 長方形の 面積は 何cm²ですか。",
            "24",
            "cm²",
            "4*6",
            "長方形の面積＝たて×よこ なので 4×6＝24cm²",
        ),
        calc_q(
            "t-0056",
            4,
            u,
            "1辺が 7cm の 正方形の 面積は 何cm²ですか。",
            "49",
            "cm²",
            "7*7",
            "正方形の面積＝1辺×1辺 なので 7×7＝49cm²",
        ),
        calc_q(
            "t-0057",
            4,
            u,
            "たて 9m、よこ 5m の 長方形の 畑の 面積は 何m²ですか。",
            "45",
            "m²",
            "9*5",
            "9×5＝45m²",
        ),
        calc_q(
            "t-0058",
            4,
            u,
            "1辺が 12m の 正方形の 花だんの 面積は 何m²ですか。",
            "144",
            "m²",
            "12*12",
            "12×12＝144m²",
        ),
        conv(
            "t-0059", 4, u, "1m²", "cm²", "10000", "1m＝100cm なので 100×100＝10000cm²"
        ),
        calc_q(
            "t-0060",
            4,
            u,
            "面積が 56cm² で、たてが 7cm の 長方形が あります。よこは 何cmですか。",
            "8",
            "cm",
            "56/7",
            "面積÷たて＝よこ なので 56÷7＝8cm",
        ),
        conv(
            "t-0061",
            4,
            u,
            "3m²",
            "cm²",
            "30000",
            "1m²＝10000cm² なので 3×10000＝30000cm²",
        ),
        calc_q(
            "t-0062",
            4,
            u,
            "たて 25cm、よこ 8cm の 長方形の 面積は 何cm²ですか。",
            "200",
            "cm²",
            "25*8",
            "25×8＝200cm²",
        ),
        conv(
            "t-0063",
            4,
            u,
            "20000cm²",
            "m²",
            "2",
            "10000cm²＝1m² なので 20000÷10000＝2m²",
        ),
        calc_q(
            "t-0064",
            4,
            u,
            "面積が 48m² で、たてが 6m の 長方形の 花だんが あります。よこは 何mですか。",
            "8",
            "m",
            "48/6",
            "面積÷たて＝よこ なので 48÷6＝8m",
        ),
        calc_q(
            "t-0065",
            4,
            u,
            "1辺が 15cm の 正方形の 面積は 何cm²ですか。",
            "225",
            "cm²",
            "15*15",
            "15×15＝225cm²",
        ),
    ]


def stage5() -> list[Problem]:
    """段階5: 4年 大きな面積（a・ha・km²）（11問）。"""
    u = "面積"
    return [
        calc_q(
            "t-0066",
            5,
            u,
            "たて 10m、よこ 10m の 正方形の 畑は 何aですか。",
            "1",
            "a",
            "10*10/100",
            "10m×10m＝100m² で、これが 1a です",
        ),
        conv("t-0067", 5, u, "3a", "m²", "300", "1a＝100m² なので 3×100＝300m²"),
        conv("t-0068", 5, u, "800m²", "a", "8", "100m²＝1a なので 800÷100＝8a"),
        conv("t-0069", 5, u, "1ha", "a", "100", "1ha＝100a です"),
        conv("t-0070", 5, u, "1ha", "m²", "10000", "1ha＝100a＝10000m² です"),
        conv(
            "t-0071", 5, u, "2ha", "m²", "20000", "1ha＝10000m² なので 2×10000＝20000m²"
        ),
        calc_q(
            "t-0072",
            5,
            u,
            "たて 200m、よこ 300m の 土地は 何haですか。",
            "6",
            "ha",
            "200*300/10000",
            "200×300＝60000m² で、10000m²＝1ha なので 6ha",
        ),
        conv("t-0073", 5, u, "1km²", "ha", "100", "1km²＝100ha です"),
        conv(
            "t-0074",
            5,
            u,
            "1km²",
            "m²",
            "1000000",
            "1km＝1000m なので 1000×1000＝1000000m²",
        ),
        calc_q(
            "t-0075",
            5,
            u,
            "たて 2km、よこ 3km の 長方形の 島の 面積は 何km²ですか。",
            "6",
            "km²",
            "2*3",
            "2×3＝6km²",
        ),
        conv("t-0076", 5, u, "5km²", "ha", "500", "1km²＝100ha なので 5×100＝500ha"),
    ]


def stage6() -> list[Problem]:
    """段階6: 4年 単位えらび（14問・3択）。"""
    return [
        pick(
            "t-0077",
            "つくえの 高さは およそ 70（　）です。",
            "cm",
            ("cm", "m", "mm"),
            "つくえの高さは70cmくらい。70mだとビルの高さになってしまう",
        ),
        pick(
            "t-0078",
            "学校の プールの 長さは およそ 25（　）です。",
            "m",
            ("m", "km", "cm"),
            "プールの長さは25mくらい",
        ),
        pick(
            "t-0079",
            "歩いて 30分くらいの 道のりは およそ 2（　）です。",
            "km",
            ("km", "m", "cm"),
            "歩いて30分くらいの道のりは2kmくらい",
        ),
        pick(
            "t-0080",
            "教科書を 入れた ランドセルの 重さは およそ 3（　）です。",
            "kg",
            ("kg", "g", "t"),
            "ランドセルは3kgくらい",
        ),
        pick(
            "t-0081",
            "えんぴつ 1本の 重さは およそ 6（　）です。",
            "g",
            ("g", "kg", "t"),
            "えんぴつ1本は6gくらい。6kgだと重すぎる",
        ),
        pick(
            "t-0082",
            "ぞう 1頭の 重さは およそ 5（　）です。",
            "t",
            ("t", "kg", "g"),
            "ぞうは5tくらい（5000kg）",
        ),
        pick(
            "t-0083",
            "牛にゅうパック 1本の かさは 1（　）です。",
            "L",
            ("L", "mL", "dL"),
            "牛にゅうパックは1L＝1000mL",
        ),
        pick(
            "t-0084",
            "計りょうスプーンの 小さじ 1ぱいの 水の かさは およそ 5（　）です。",
            "mL",
            ("mL", "dL", "L"),
            "小さじ1ぱいは5mLくらい",
        ),
        pick(
            "t-0085",
            "おふろに 入れる おゆの かさは およそ 200（　）です。",
            "L",
            ("L", "dL", "mL"),
            "おふろのおゆは200Lくらい",
        ),
        pick(
            "t-0086",
            "50m走を 走る 時間は およそ 9（　）です。",
            "秒",
            ("秒", "分", "時間"),
            "50m走は9秒くらい",
        ),
        pick(
            "t-0087",
            "一日の ねている 時間は およそ 9（　）です。",
            "時間",
            ("時間", "分", "秒"),
            "ねている時間は9時間くらい",
        ),
        pick(
            "t-0088",
            "教室の ゆかの 面積は およそ 60（　）です。",
            "m²",
            ("m²", "cm²", "a"),
            "教室のゆかは60m²くらい。60aだと6000m²で広すぎる",
        ),
        pick(
            "t-0089",
            "ノート 1ページの 面積は およそ 500（　）です。",
            "cm²",
            ("cm²", "m²", "a"),
            "ノート1ページは500cm²くらい",
        ),
        pick(
            "t-0090",
            "東京ドームの 広さは およそ 5（　）です。",
            "ha",
            ("ha", "a", "km²"),
            "東京ドームは5haくらい（約47000m²）",
        ),
    ]


def stage7() -> list[Problem]:
    """段階7: 4年 まとめの文章題（10問）。"""
    u = "文章題"
    return [
        calc_q(
            "t-0091",
            7,
            u,
            "1m50cm の ひもから 80cm つかいました。のこりは 何cmですか。",
            "70",
            "cm",
            "150-80",
            "1m50cm＝150cm なので 150cm－80cm＝70cm",
        ),
        calc_q(
            "t-0092",
            7,
            u,
            "牛にゅうが 1L と 300mL あります。あわせて 何mLですか。",
            "1300",
            "mL",
            "1000+300",
            "1L＝1000mL なので 1000mL＋300mL＝1300mL",
        ),
        calc_q(
            "t-0093",
            7,
            u,
            "1.5kg の にもつと 800g の にもつを あわせると 何gですか。",
            "2300",
            "g",
            "1500+800",
            "1.5kg＝1500g なので 1500g＋800g＝2300g",
        ),
        calc_q(
            "t-0094",
            7,
            u,
            "家から 学校まで 1.2km、学校から 駅まで 800m です。家から 学校を 通って 駅まで 何mですか。",
            "2000",
            "m",
            "1200+800",
            "1.2km＝1200m なので 1200m＋800m＝2000m",
        ),
        calc_q(
            "t-0095",
            7,
            u,
            "25cm の リボンを 8本 つくります。リボンは ぜんぶで 何m いりますか。",
            "2",
            "m",
            "25*8/100",
            "25×8＝200cm で、100cm＝1m なので 2m",
        ),
        calc_q(
            "t-0096",
            7,
            u,
            "6L の お茶を 5人で 同じ りょうずつ 分けます。1人分は 何dLですか。",
            "12",
            "dL",
            "6*10/5",
            "6L＝60dL なので 60÷5＝12dL",
        ),
        calc_q(
            "t-0097",
            7,
            u,
            "1時間20分の えいがを 見はじめて 35分 たちました。あと 何分で おわりますか。",
            "45",
            "分",
            "80-35",
            "1時間20分＝80分 なので 80分－35分＝45分",
        ),
        calc_q(
            "t-0098",
            7,
            u,
            "1日 20分ずつ 9日間 そうじを しました。ぜんぶで 何時間ですか。",
            "3",
            "時間",
            "20*9/60",
            "20×9＝180分 で、60分＝1時間 なので 3時間",
        ),
        calc_q(
            "t-0099",
            7,
            u,
            "たて 800cm、よこ 5m の 長方形の 花だんの 面積は 何m²ですか。",
            "40",
            "m²",
            "800/100*5",
            "800cm＝8m なので 8×5＝40m²",
        ),
        calc_q(
            "t-0100",
            7,
            u,
            "4kg500g の にもつを 3人で 同じ 重さずつ 分けます。1人分は 何gですか。",
            "1500",
            "g",
            "4500/3",
            "4kg500g＝4500g なので 4500÷3＝1500g",
        ),
    ]


def build_problems() -> list[Problem]:
    """全問題を stage 順・ソース順に返す。"""
    return [
        *stage1(),
        *stage2(),
        *stage3(),
        *stage4(),
        *stage5(),
        *stage6(),
        *stage7(),
    ]


# ---------------------------------------------------------------------------
# 検算（Decimal のみ。float は使わない）
# ---------------------------------------------------------------------------


def _eval_node(node: ast.AST) -> Decimal:
    """四則演算だけを許可して式の木を Decimal で評価する。"""
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return Decimal(node.value)
    if isinstance(node, ast.BinOp):
        left, right = _eval_node(node.left), _eval_node(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
    raise ValueError(f"許可されていない式です: {ast.dump(node)}")


def eval_expr(expr: str) -> Decimal:
    """整数と四則演算だけの式を Decimal で計算する。"""
    return _eval_node(ast.parse(expr, mode="eval").body)


def to_base(text: str) -> tuple[str, Decimal]:
    """「3cm4mm」を (次元, 基準単位での値) にする。全体が分解できることを確認する。"""
    tokens = TOKEN_PATTERN.findall(text)
    assert tokens and "".join(n + u for n, u in tokens) == text, f"分解できない: {text}"
    dims = {UNIT_TABLE[u][0] for _, u in tokens}
    assert len(dims) == 1, f"次元が混在: {text}"
    total = sum((Decimal(n) * UNIT_TABLE[u][1] for n, u in tokens), Decimal(0))
    return dims.pop(), total


def eval_conv(src: str, dst: str) -> Decimal:
    """src を dst の単位で表した値を返す（次元が違えば失敗）。"""
    dim, base_value = to_base(src)
    dst_dim, dst_factor = UNIT_TABLE[dst]
    assert dim == dst_dim, f"次元が違う: {src} -> {dst}"
    return base_value / dst_factor


def compute(problem: Problem) -> Decimal:
    """calc に従って検算値を返す。"""
    kind = problem.calc[0]
    if kind == "conv":
        return eval_conv(problem.calc[1], problem.calc[2])
    if kind == "expr":
        return eval_expr(problem.calc[1])
    raise ValueError(f"不明な calc: {problem.calc}")


def normalize(value: Decimal) -> str:
    """末尾の 0 や小数点を付けない 10 進表記にする。"""
    return format(value.normalize(), "f")


# ---------------------------------------------------------------------------
# assert（どれか1つでも外れたら失敗終了）
# ---------------------------------------------------------------------------


def check_counts(problems: list[Problem]) -> None:
    """総数・stage 別・unit 別の件数を確認する。"""
    assert len(problems) == TOTAL_PROBLEMS, f"総数が違う: {len(problems)}"
    for stage, (_, count) in STAGES.items():
        in_stage = [p for p in problems if p.stage == stage]
        assert len(in_stage) == count, f"stage{stage} の件数: {len(in_stage)}"
        for unit, expected in EXPECTED_UNITS_BY_STAGE[stage].items():
            actual = sum(1 for p in in_stage if p.unit == unit)
            assert actual == expected, f"stage{stage} {unit}: {actual}"
    for unit, expected in EXPECTED_UNIT_TOTALS.items():
        actual = sum(1 for p in problems if p.unit == unit)
        assert actual == expected, f"unit {unit} 合計: {actual}"
    stages_in_order = [p.stage for p in problems]
    assert stages_in_order == sorted(stages_in_order), "stage 順に並んでいない"


def check_ids(problems: list[Problem]) -> None:
    """id の形式と重複を確認する。"""
    ids = [p.id for p in problems]
    assert all(ID_PATTERN.match(i) for i in ids), "id の形式が t-0000 ではない"
    assert len(set(ids)) == len(ids), "id が重複している"


def check_choice(problem: Problem) -> None:
    """3択・重複なし・answer を含むことを確認する。"""
    assert len(problem.choices) == CHOICE_COUNT, f"{problem.id}: 選択肢の数"
    assert len(set(problem.choices)) == CHOICE_COUNT, f"{problem.id}: 選択肢の重複"
    assert problem.answer in problem.choices, f"{problem.id}: 答えが選択肢にない"


def check_number(problem: Problem) -> None:
    """answer が正規化済みで検算と一致することを確認する。"""
    assert problem.calc, f"{problem.id}: calc がない"
    expected = normalize(compute(problem))
    assert problem.answer == expected, (
        f"{problem.id}: answer={problem.answer} 検算={expected}"
    )


def check_each(problems: list[Problem]) -> None:
    """問題ごとの型別チェックと共通項目の確認。"""
    for p in problems:
        assert p.type in ("number", "choice"), f"{p.id}: type"
        assert p.prompt and p.explain, f"{p.id}: prompt/explain が空"
        if p.type == "choice":
            check_choice(p)
        else:
            check_number(p)


def read_existing_ids(path: Path) -> set[str]:
    """既存 data.js にある id を集める（無ければ空）。"""
    if not path.exists():
        return set()
    return set(ID_IN_JS_PATTERN.findall(path.read_text(encoding="utf-8")))


def check_existing_ids_kept(problems: list[Problem], existing: set[str]) -> None:
    """既存 data.js にあった id が全部残っていることを確認する。"""
    missing = existing - {p.id for p in problems}
    assert not missing, f"既存の id が消えている: {sorted(missing)}"


# ---------------------------------------------------------------------------
# 書き出し
# ---------------------------------------------------------------------------


def to_js_object(problem: Problem) -> str:
    """1問を JS のオブジェクト表記にする。"""
    parts = [
        ("id", problem.id),
        ("stage", problem.stage),
        ("unit", problem.unit),
        ("type", problem.type),
        ("prompt", problem.prompt),
        ("answer", problem.answer),
    ]
    if problem.type == "number":
        parts.append(("suffix", problem.suffix))
    else:
        parts.append(("choices", list(problem.choices)))
    parts.append(("explain", problem.explain))
    body = ", ".join(
        f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in parts
    )
    return f"  {{ {body} }}"


def render_js(problems: list[Problem]) -> str:
    """data.js 全体の文字列を作る。"""
    header = "// 自動生成。直接編集しない。元は gen/make_data.py\n"
    items = ",\n".join(to_js_object(p) for p in problems)
    return f"{header}window.TANI_PROBLEMS = [\n{items},\n];\n"


def main(argv: list[str]) -> int:
    """問題を作って検査し、data.js に書き出す。"""
    assert len(argv) == 2, "使い方: python3 gen/make_data.py data.js"
    out_path = Path(argv[1])
    problems = build_problems()
    check_counts(problems)
    check_ids(problems)
    check_each(problems)
    check_existing_ids_kept(problems, read_existing_ids(out_path))
    out_path.write_text(render_js(problems), encoding="utf-8")
    print(f"OK: {len(problems)} 問を {out_path} に書き出しました")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
