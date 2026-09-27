#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>
#include <unordered_map>
#include <stdexcept>
#include "tables.hpp"
#include "deck-coefficients.hpp"
struct State {
 int p=1,t=0,b=0,n=0,h[5]={}; uint32_t deck=0x3fffffff;
 bool terminal()const{return t>=100&&!b;}
};
struct Codec {
 int idmap[31]={},representative[23]={},types[23]={},capacity[23]={},stride[23]={},K=0,comb[28][7]={};
 Codec(){for(int id=1;id<=30;id++){int c=1;for(;c<=K;c++)if(CTYPE[representative[c]]==CTYPE[id]&&CVAL[representative[c]]==CVAL[id])break;if(c>K){K=c;representative[c]=id;types[c]=CTYPE[id];}idmap[id]=c;capacity[c]++;}int x=1;for(int c=1;c<=K;c++){stride[c]=x;x*=capacity[c]+1;}if(K!=22||x!=107495424)throw std::runtime_error("unexpected card classes");for(int i=0;i<28;i++){comb[i][0]=1;for(int j=1;j<=6;j++)comb[i][j]=i?comb[i-1][j-1]+comb[i-1][j]:0;}}
 int rank(const int*c,int n)const{if(!n)return 0;int ans=comb[22+n-1][n-1],prev=1;for(int i=0;i<n;i++){int r=n-i;ans+=comb[22-prev+r][r]-comb[22-c[i]+r][r];prev=c[i];}return ans;}
 int hand(const State&s,int skip=-1)const{int c[5],n=0;for(int i=0;i<s.n;i++)if(i!=skip)c[n++]=idmap[s.h[i]];std::sort(c,c+n);return rank(c,n);}
 uint32_t deckCode(uint32_t deck)const{uint32_t d=0;while(deck){int bit=__builtin_ctz(deck);deck&=deck-1;d+=stride[idmap[bit+1]];}return d;}
 uint64_t key(const State&s)const{return uint64_t(s.p)|(uint64_t(100-s.t)<<12)|(uint64_t(s.b)<<19)|(uint64_t(hand(s))<<20)|(uint64_t(deckCode(s.deck))<<37);}
};
struct KeyHash{size_t operator()(uint64_t x)const{x=(x^(x>>30))*0xbf58476d1ce4e5b9ULL;x=(x^(x>>27))*0x94d049bb133111ebULL;return x^(x>>31);}};
